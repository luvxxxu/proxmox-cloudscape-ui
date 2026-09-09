export interface ApiParameter {
  type?: string;
  description?: string;
  optional?: boolean | number;
  default?: unknown;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: unknown;
  pattern?: string;
  items?: ApiParameter;
  requires?: string;
  oneOf?: ApiParameter[];
  'instance-types'?: string[];
  'type-property'?: string;
}

export interface ApiParameterSchema {
  properties?: Record<string, ApiParameter>;
  additionalProperties?: boolean | number;
  allOf?: ApiParameterSchema[];
  oneOf?: ApiParameterSchema[];
  'instance-type'?: string;
  'type-property'?: string;
  'type-property-schema'?: ApiParameter;
}

export interface ApiOperation {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  deprecated?: unknown;
  parameters: ApiParameterSchema;
  permissions: unknown;
  returns: unknown;
}

export interface ApiCatalog {
  source: string;
  retrievedAt: string;
  sha256: string;
  operations: ApiOperation[];
}

const forbiddenNames = new Set(['__proto__', 'constructor', 'prototype']);
export const isSecretParameter = (name: string) => !/^(?:full-)?tokenid$/i.test(name) && /password|passphrase|secret|ticket|token|private|client-key|api[-_]?key|credential|recovery|keyring|^key$|^keydata$|^value$|^uri$|^totp$|^tfa$/i.test(name);
export const isUploadOperation = (operation: ApiOperation) => operation.method === 'POST' && /\/storage\/\{storage\}\/upload$/.test(operation.path);
export const isWebsocketOperation = (operation: ApiOperation) => operation.path.endsWith('/vncwebsocket');

function schemaProperties(schema: ApiParameterSchema): Record<string, ApiParameter> {
  const properties = { ...schema.properties };
  for (const part of schema.allOf ?? []) Object.assign(properties, schemaProperties(part));
  if (schema.oneOf) {
    const discriminator = schema['type-property'];
    if (discriminator && schema['type-property-schema']) properties[discriminator] = schema['type-property-schema'];
    const branches = schema.oneOf.map(branch => ({ type: branch['instance-type'], properties: schemaProperties(branch) }));
    const names = new Set(branches.flatMap(branch => Object.keys(branch.properties)));
    for (const name of names) {
      const choices = branches.flatMap(branch => branch.properties[name] ? [{ ...branch.properties[name], ...(branch.type ? { 'instance-types': [branch.type] } : {}) }] : []);
      properties[name] = { ...choices[0], optional: choices.every(choice => choice.optional), oneOf: choices, 'type-property': discriminator };
    }
  }
  return properties;
}

export function operationParameters(operation: ApiOperation): Record<string, ApiParameter> {
  const properties = schemaProperties(operation.parameters);
  // Some official routes omit their path arguments from the generated parameter schema.
  // Keep the documented route usable without inventing validation beyond a required string.
  for (const match of operation.path.matchAll(/\{([^}]+)\}/g)) {
    if (!Object.hasOwn(properties, match[1])) properties[match[1]] = { type: 'string', description: 'Resource identifier from the documented API path.' };
  }
  return properties;
}

export function parameterDefinition(operation: ApiOperation, name: string): ApiParameter | undefined {
  if (forbiddenNames.has(name) || name.includes('[n]')) return undefined;
  const properties = operationParameters(operation);
  if (Object.hasOwn(properties, name)) return properties[name];
  for (const [key, definition] of Object.entries(properties)) {
    if (!key.includes('[n]')) continue;
    const [prefix, suffix] = key.split('[n]');
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const index = name.slice(prefix.length, suffix ? -suffix.length : undefined);
    if (/^\d+$/.test(index)) return definition;
  }
  return undefined;
}

/** Proxmox's tagged schemas make requiredness depend on a protocol/type field. */
export function effectiveParameter(definition: ApiParameter, values: Record<string, string>): ApiParameter {
  const discriminator = definition['type-property'];
  const type = discriminator ? values[discriminator] : undefined;
  if (definition.oneOf) {
    const branch = definition.oneOf.find(candidate => type && candidate['instance-types']?.includes(type));
    if (branch) return { ...definition, ...branch, oneOf: undefined };
    return { ...definition, optional: definition.oneOf.every(candidate => candidate.optional) || Boolean(type), oneOf: undefined };
  }
  if (type && definition['instance-types'] && !definition['instance-types'].includes(type)) return { ...definition, optional: true };
  return definition;
}

export function parameterApplies(definition: ApiParameter, values: Record<string, string>): boolean {
  const discriminator = definition['type-property'];
  const type = discriminator ? values[discriminator] : undefined;
  if (!type) return true; // Updates can omit the discriminator; the server resolves existing configuration.
  if (definition.oneOf) return definition.oneOf.some(candidate => !candidate['instance-types'] || candidate['instance-types'].includes(type));
  return !definition['instance-types'] || definition['instance-types'].includes(type);
}

function validateParameter(value: string, definition: ApiParameter): string | undefined {
  if (definition.enum && !definition.enum.some(item => String(item) === value)) return `Choose one of: ${definition.enum.join(', ')}.`;
  if (definition.type === 'integer' || definition.type === 'number') {
    const number = Number(value);
    const validSyntax = definition.type === 'integer' ? /^[+-]?\d+$/.test(value) : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
    if (!validSyntax || !Number.isFinite(number) || (definition.type === 'integer' && !Number.isSafeInteger(number))) return `Enter a valid ${definition.type}.`;
    if (definition.minimum !== undefined && number < definition.minimum) return `Minimum: ${definition.minimum}.`;
    if (definition.maximum !== undefined && number > definition.maximum) return `Maximum: ${definition.maximum}.`;
  }
  if (definition.type === 'boolean' && !['0', '1'].includes(value)) return 'Choose enabled or disabled.';
  if (definition.minLength !== undefined && value.length < definition.minLength) return `Minimum length: ${definition.minLength}.`;
  if (definition.maxLength !== undefined && value.length > definition.maxLength) return `Maximum length: ${definition.maxLength}.`;
  if (definition.type === 'array') {
    try {
      const values: unknown = JSON.parse(value);
      if (!Array.isArray(values)) return 'Enter a JSON array.';
      if (!values.length) return 'Provide at least one array entry, or omit this field. Use the documented delete parameter to clear a setting.';
      for (const item of values) {
        if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') return 'Array entries must be strings, numbers, or booleans.';
        const error = definition.items && validateParameter(typeof item === 'boolean' ? (item ? '1' : '0') : String(item), definition.items);
        if (error) return error;
      }
    } catch { return 'Enter a JSON array.'; }
  }
  // Proxmox patterns and custom formats use Perl syntax. Never execute catalog regexes in the browser.
}

export function buildApiRequest(operation: ApiOperation, fields: Record<string, string>, extra: string = '{}', file?: File) {
  const errors: Record<string, string> = {};
  const values: Record<string, string> = { ...fields };
  const explicitEmpty = new Set<string>();
  try {
    const parsed: unknown = JSON.parse(extra || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Enter a JSON object.');
    for (const [key, value] of Object.entries(parsed)) {
      if (forbiddenNames.has(key) || /[\u0000-\u001f\u007f]/.test(key)) throw new Error(`Invalid parameter: ${key}`);
      if (Object.hasOwn(fields, key) && fields[key] !== '') throw new Error(`Parameter already entered: ${key}`);
      if (!parameterDefinition(operation, key) && !operation.parameters.additionalProperties) throw new Error(`Unknown parameter: ${key}`);
      if (value === null || value === undefined || typeof value === 'object' && !Array.isArray(value)) throw new Error(`Invalid value: ${key}`);
      values[key] = typeof value === 'boolean' ? (value ? '1' : '0') : Array.isArray(value) ? JSON.stringify(value) : String(value);
      if (value === '') explicitEmpty.add(key);
    }
  } catch (error) { errors._extra = error instanceof Error ? error.message : 'Invalid additional parameters.'; }

  const upload = isUploadOperation(operation);
  const pathParameters = new Set([...operation.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]));
  for (const name of pathParameters) {
    const defaultValue = parameterDefinition(operation, name)?.default;
    if (!values[name] && (typeof defaultValue === 'string' || typeof defaultValue === 'number')) values[name] = String(defaultValue);
  }
  for (const [name, original] of Object.entries(operationParameters(operation))) {
    if (name.includes('[n]') || upload && ['filename', 'tmpfilename'].includes(name)) continue;
    const definition = effectiveParameter(original, values);
    if (!definition.optional && !explicitEmpty.has(name) && (values[name] === undefined || values[name] === '')) errors[name] = 'This field is required.';
  }
  if (upload && !file) errors.filename = 'Choose a file to upload.';
  for (const [name, value] of Object.entries(values)) {
    if (value === '' && !explicitEmpty.has(name)) continue;
    const original = parameterDefinition(operation, name);
    if (forbiddenNames.has(name) || !original && !operation.parameters.additionalProperties) errors[name] = 'Unknown parameter.';
    if (!original) continue;
    const definition = effectiveParameter(original, values);
    if (!parameterApplies(original, values)) errors[name] = `This parameter does not apply to ${original['type-property']}=${values[original['type-property'] ?? '']}.`;
    const error = validateParameter(value, definition);
    if (error) errors[name] = error;
    if (definition.requires && !values[definition.requires] && !explicitEmpty.has(definition.requires)) errors[name] = `Also provide ${definition.requires}.`;
  }
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values[name] ?? '';
    if (!value || value === '.' || value === '..' || /[\u0000-\u001f\u007f]/.test(value)) errors[name] = 'Enter a valid resource identifier.';
    try { return encodeURIComponent(value); }
    catch { errors[name] = 'Enter a valid Unicode resource identifier.'; return ''; }
  });
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (pathParameters.has(name) || value === '' && !explicitEmpty.has(name) || upload && ['filename', 'tmpfilename'].includes(name)) continue;
    const definition = parameterDefinition(operation, name);
    if (definition?.type === 'array') {
      try { const array: unknown = JSON.parse(value); if (Array.isArray(array)) for (const item of array) parameters.append(name, typeof item === 'boolean' ? (item ? '1' : '0') : String(item)); } catch { /* Reported above. */ }
    } else parameters.append(name, value);
  }
  const query = parameters.toString();
  const url = `/api/proxmox${path}${operation.method === 'GET' && query ? `?${query}` : ''}`;
  let body: URLSearchParams | FormData | undefined = operation.method === 'GET' ? undefined : parameters;
  if (upload) {
    body = new FormData();
    parameters.forEach((value, name) => (body as FormData).append(name, value));
    if (file) body.append('filename', file, file.name);
  }
  return { url, body, errors, path, values };
}

export function redactApiData(value: unknown, response = false): unknown {
  if (typeof value === 'string') {
    if (response && !value.startsWith('UPID:')) return '••••••••';
    if (/-----BEGIN [^-]*PRIVATE KEY-----|(?:password|secret|token|key)\s*=/i.test(value)) return '••••••••';
    return value;
  }
  if (Array.isArray(value)) return value.map(item => redactApiData(item, response));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isSecretParameter(key) ? '••••••••' : redactApiData(item, response && key === 'data')]));
  return value;
}

export function responseFilename(contentDisposition: string | null, contentType: string): string {
  let name = '';
  const encoded = contentDisposition?.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, '');
  if (encoded) { try { name = decodeURIComponent(encoded); } catch { /* Fall back to the plain filename. */ } }
  if (!name) name = contentDisposition?.match(/filename\s*=\s*(?:"([^"]*)"|([^;]*))/i)?.slice(1).find(Boolean)?.trim() ?? '';
  name = name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) ?? '';
  if (name && name !== '.' && name !== '..') return name;
  const extension = /json/i.test(contentType) ? 'json' : /pem|pkix-cert|x-x509/i.test(contentType) ? 'pem' : /zip/i.test(contentType) ? 'zip' : /text\//i.test(contentType) ? 'txt' : 'bin';
  return `proxmox-response.${extension}`;
}
