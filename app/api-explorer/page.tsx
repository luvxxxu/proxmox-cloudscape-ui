"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import FileUpload from '@cloudscape-design/components/file-upload';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import Pagination from '@cloudscape-design/components/pagination';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Textarea from '@cloudscape-design/components/textarea';
import TextFilter from '@cloudscape-design/components/text-filter';
import { apiFetch } from '@/app/lib/api-client';
import { useTranslation } from '@/app/lib/use-translation';
import { useNotifications } from '@/app/components/notifications';
import { buildApiRequest, isSecretParameter, isUploadOperation, isWebsocketOperation, redactApiData, effectiveParameter, operationParameters, responseFilename, type ApiCatalog, type ApiOperation, type ApiParameter } from '@/app/lib/proxmox-api-schema';

export default function ApiExplorerPage() {
  const { language } = useTranslation();
  const local = useCallback((ko: string, en: string) => language === 'ko' ? ko : en, [language]);
  const [catalog, setCatalog] = useState<ApiCatalog | null>(null);
  const [error, setError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<ApiOperation | null>(null);
  const [lifecycle, setLifecycle] = useState({ dirty: false, pending: false });
  const [nextSelection, setNextSelection] = useState<{ operation: ApiOperation | null } | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const requestSelection = (operation: ApiOperation | null) => {
    if (operation?.id === selected?.id) return;
    if (lifecycle.pending) { setSelectionError(local('현재 요청을 처리하고 있습니다. 응답을 받은 뒤 다른 작업을 선택하세요.', 'The current request is pending. Wait for its response before selecting another operation.')); return; }
    setSelectionError('');
    if (lifecycle.dirty) { setNextSelection({ operation }); return; }
    setSelected(operation);
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch('/proxmox-api-schema.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: ApiCatalog = await response.json();
      if (!Array.isArray(data.operations)) throw new Error('Invalid API catalog');
      if (controller.signal.aborted) return;
      setCatalog(data);
      setError('');
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)); }).finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const { items, collectionProps, filterProps, paginationProps, actions } = useCollection(catalog?.operations ?? [], {
    filtering: { empty: <Box>{local('등록된 작업이 없습니다.', 'No operations.')}</Box>, noMatch: <Box>{local('일치하는 작업이 없습니다.', 'No matching operations.')}</Box> },
    pagination: { pageSize: 10 }, sorting: {},
  });
  return <SpaceBetween size="l">
    <Header variant="h1" description={local('Proxmox의 전체 API에서 작업을 찾고 공식 매개변수로 실행합니다. 연결된 서버의 권한과 버전 제한이 적용됩니다.', 'Find operations across the Proxmox API and execute them using the documented parameters. Your server permissions and version apply.')}>
      {local('전체 API 관리', 'API management')}
    </Header>
    {Boolean(error) && <Alert type="error" action={<Button onClick={() => { setCatalogLoading(true); setError(''); setAttempt(value => value + 1); }}>{local('다시 시도', 'Retry')}</Button>}>{error}</Alert>}
    {Boolean(selectionError) && <Alert type="info" dismissible onDismiss={() => setSelectionError('')}>{selectionError}</Alert>}
    <Table {...collectionProps} items={items} trackBy="id" loading={catalogLoading} loadingText={local('API 목록 불러오는 중', 'Loading API catalog')}
      variant="full-page" wrapLines
      empty={<Box>{local('일치하는 작업이 없습니다.', 'No matching operations.')} {filterProps.filteringText && <Button onClick={() => actions.setFiltering('')}>{local('검색 지우기', 'Clear filter')}</Button>}</Box>}
      columnDefinitions={[
        { id: 'method', header: local('메서드', 'Method'), cell: item => item.method, sortingField: 'method', width: 100 },
        { id: 'path', header: local('경로', 'Path'), cell: item => <Link onFollow={event => { event.preventDefault(); requestSelection(item); }} href="#operation">{item.path}</Link>, sortingField: 'path', width: 450 },
        { id: 'description', header: local('설명', 'Description'), cell: item => item.description, sortingField: 'description' },
      ]}
      header={<Header counter={catalog ? `(${catalog.operations.length})` : undefined} description={catalog ? `${local('공식 문서 수집일', 'Documentation retrieved')}: ${new Date(catalog.retrievedAt).toLocaleDateString(language)}` : undefined}>{local('작업 목록', 'Operations')}</Header>}
      filter={<TextFilter {...filterProps} filteringPlaceholder={local('사용자, Ceph, SDN, 인증서, 작업 경로 검색', 'Search users, Ceph, SDN, certificates, or paths')} filteringAriaLabel={local('API 작업 검색', 'Search API operations')} />}
      pagination={<Pagination {...paginationProps} ariaLabels={{ nextPageLabel: local("다음 페이지", "Next page"), previousPageLabel: local("이전 페이지", "Previous page"), pageLabel: page => `${local("페이지", "Page")} ${page}` }} />}
    />
    {selected && <OperationForm key={selected.id} operation={selected} onClose={() => requestSelection(null)} onLifecycleChange={setLifecycle} />}
    {nextSelection && <Modal visible closeAriaLabel={local('대화 상자 닫기', 'Close dialog')} onDismiss={() => setNextSelection(null)} header={local('현재 작업을 닫으시겠습니까?', 'Leave the current operation?')} footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setNextSelection(null)}>{local('계속 편집', 'Keep editing')}</Button><Button variant="primary" onClick={() => { setSelected(nextSelection.operation); setNextSelection(null); setLifecycle({ dirty: false, pending: false }); }}>{local('변경 사항 버리고 닫기', 'Discard and leave')}</Button></SpaceBetween></Box>}>
      {local('입력한 값과 표시된 응답이 사라집니다. 다시 표시되지 않는 비밀 값이나 다운로드 파일을 먼저 보관하세요.', 'Entered values and displayed responses will be removed. Save any one-time secrets or downloaded files first.')}
    </Modal>}
  </SpaceBetween>;
}

function OperationForm({ operation, onClose, onLifecycleChange }: { operation: ApiOperation; onClose: () => void; onLifecycleChange: (state: { dirty: boolean; pending: boolean }) => void }) {
  const { language } = useTranslation();
  const local = useCallback((ko: string, en: string) => language === 'ko' ? ko : en, [language]);
  const { trackTask } = useNotifications();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('{}');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [result, setResult] = useState<{ data: unknown; task: boolean } | null>(null);
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [leaveUrl, setLeaveUrl] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  const inputs = useRef<Record<string, { focus(): void } | null>>({});
  const busy = useRef(false);
  const mounted = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const approvedNavigation = useRef(false);
  const dirty = Object.values(fields).some(value => value !== '') || extra.trim() !== '{}' || files.length > 0 || result !== null || download !== null;
  useEffect(() => { onLifecycleChange({ dirty, pending }); }, [dirty, pending, onLifecycleChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (operation.method === 'GET') requestController.current?.abort(); };
  }, [operation.method]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!approvedNavigation.current) { event.preventDefault(); event.returnValue = ''; } };
    const beforeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault(); event.stopPropagation();
      if (busy.current) setError(local('요청이 처리 중입니다. 응답을 받을 때까지 이 화면에 머무르세요.', 'A request is pending. Stay on this page until its response arrives.'));
      else setLeaveUrl(url.href);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeLink, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeLink, true); };
  }, [dirty, pending, local]);
  useEffect(() => { heading.current?.scrollIntoView({ block: 'start' }); heading.current?.focus(); }, []);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  const properties = Object.entries(operationParameters(operation));
  const upload = isUploadOperation(operation);
  const prepared = buildApiRequest(operation, fields, extra, files[0]);
  const visible = properties.filter(([name]) => !name.includes('[n]') && !(upload && ['filename', 'tmpfilename'].includes(name))).map(([name, definition]): [string, ApiParameter] => [name, effectiveParameter(definition, prepared.values)]);
  const required = visible.filter(([, definition]) => !definition.optional);
  const optional = visible.filter(([, definition]) => !!definition.optional);
  const validateField = (name: string, value: string) => {
    const message = buildApiRequest(operation, { ...fields, [name]: value }, extra, files[0]).errors[name];
    setErrors(current => { const next = { ...current }; if (message) next[name] = message; else delete next[name]; return next; });
  };
  const update = (name: string, value: string) => {
    setFields(current => ({ ...current, [name]: value }));
    if (errors[name]) validateField(name, value);
  };
  const field = ([name, definition]: [string, ApiParameter]) => {
    const value = fields[name] ?? '';
    const options = definition.type === 'boolean'
      ? [{ label: local('활성화', 'Enabled'), value: '1' }, { label: local('비활성화', 'Disabled'), value: '0' }]
      : definition.enum?.map(item => ({ label: String(item), value: String(item) }));
    const defaultHint = definition.default === undefined ? '' : `${local('서버 기본값', 'Server default')}: ${typeof definition.default === 'object' ? JSON.stringify(definition.default) : String(definition.default)}`;
    return <FormField key={name} label={`${name}${definition.optional ? local(' — 선택 사항', ' — optional') : ''}`} description={definition.description} errorText={errors[name]} constraintText={[defaultHint, definition.type === 'array' ? local('JSON 배열을 입력하세요.', 'Enter a JSON array.') : '', definition.minimum !== undefined ? `min: ${definition.minimum}` : '', definition.maximum !== undefined ? `max: ${definition.maximum}` : ''].filter(Boolean).join(' · ')}>
      {options ? <Select ref={instance => { inputs.current[name] = instance; }} onBlur={() => validateField(name, value)} selectedOption={options.find(option => option.value === value) ?? null} options={[...(definition.optional ? [{ label: local('서버 기본값 사용', 'Use server default'), value: '' }] : []), ...options]} onChange={({ detail }) => update(name, detail.selectedOption.value ?? '')} disabled={pending} placeholder={local('선택', 'Choose an option')} />
        : !isSecretParameter(name) && (definition.type === 'array' || /cert|ssh|description|script|data|content/i.test(name))
          ? <Textarea ref={instance => { inputs.current[name] = instance; }} onBlur={() => validateField(name, value)} value={value} onChange={({ detail }) => update(name, detail.value)} disabled={pending} rows={3} />
          : <Input ref={instance => { inputs.current[name] = instance; }} onBlur={() => validateField(name, value)} value={value} onChange={({ detail }) => update(name, detail.value)} disabled={pending} type={isSecretParameter(name) ? 'password' : 'text'} autoComplete={false} />}
    </FormField>;
  };
  async function execute() {
    if (busy.current) return;
    busy.current = true;
    setPending(true); onLifecycleChange({ dirty: true, pending: true }); setConfirm(false); setError(''); setResult(null); setDownload(null); setReveal(false);
    requestController.current = new AbortController();
    try {
      const response = await apiFetch(prepared.url, { method: operation.method, body: prepared.body, maxRetries: 0, signal: requestController.current.signal });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
        const blob = await response.blob();
        if (mounted.current) {
          setDownload({ url: URL.createObjectURL(blob), filename: responseFilename(response.headers.get('content-disposition'), contentType) });
          setFields(current => Object.fromEntries(Object.entries(current).filter(([name]) => !isSecretParameter(name))));
          setExtra('{}'); setFiles([]);
        }
        return;
      }
      const json: unknown = await response.json();
      if (!json || typeof json !== 'object') throw new Error(local('서버의 JSON 응답 형식이 올바르지 않습니다.', 'The server returned an invalid JSON envelope.'));
      const envelope = json as Record<string, unknown>;
      if (!response.ok) {
        if (envelope.errors && typeof envelope.errors === 'object' && mounted.current) {
          setErrors(Object.fromEntries(Object.entries(envelope.errors).map(([key, value]) => [key, isSecretParameter(key) ? local('민감한 값이 유효하지 않습니다. 입력 조건을 확인하세요.', 'The sensitive value is invalid. Check its input constraints.') : String(value)])));
          setOptionalOpen(true); setExtraOpen(true);
        }
        throw new Error(String(envelope.error || envelope.message || `HTTP ${response.status}`));
      }
      if (!Object.hasOwn(envelope, 'data')) throw new Error(local('서버 응답에 data가 없습니다.', 'The server response is missing data.'));
      const data = envelope.data;
      const task = typeof data === 'string' && data.startsWith('UPID:');
      if (task) trackTask(data, data.split(':')[1], `${operation.method} ${prepared.path}`);
      if (!mounted.current) return;
      setResult({ data: envelope, task });
      // Retain non-sensitive configuration so it can be corrected or reused.
      setFields(current => Object.fromEntries(Object.entries(current).filter(([name]) => !isSecretParameter(name))));
      setExtra('{}'); setFiles([]);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error));
    } finally { if (mounted.current) setPending(false); busy.current = false; }
  }
  function submit() {
    if (busy.current) return;
    setError('');
    setErrors(prepared.errors);
    const names = Object.keys(prepared.errors);
    if (names.length) {
      setOptionalOpen(true); setExtraOpen(true);
      setError(local('표시된 입력 오류를 수정하세요.', 'Correct the highlighted fields.'));
      const control = inputs.current[names[0]];
      if (control) control.focus();
      else { heading.current?.scrollIntoView({ block: 'start' }); heading.current?.focus(); }
      return;
    }
    if (operation.method === 'GET') void execute();
    else { setPhrase(''); setConfirm(true); }
  }
  const format = (data: unknown) => JSON.stringify(data, null, 2);
  return <div id="operation" ref={heading} tabIndex={-1}>
    <SpaceBetween size="l">
      <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <Form variant="embedded" header={<Header variant="h2" description={operation.description}>{operation.id}</Header>} errorText={error}
          actions={<SpaceBetween direction="horizontal" size="xs"><Button formAction="none" variant="link" onClick={onClose} disabled={pending}>{local('닫기', 'Close')}</Button><Button variant="primary" loading={pending} disabled={isWebsocketOperation(operation)}>{operation.method === 'GET' ? local('조회', 'Read') : local('요청 검토', 'Review request')}</Button></SpaceBetween>}>
          <SpaceBetween size="l">
            {Object.keys(errors).filter(name => name !== '_confirm').length > 0 && <Alert type="error" header={local('입력 오류', 'Input errors')}><ul>{Object.entries(errors).filter(([name]) => name !== '_confirm').map(([name, message]) => <li key={name}><b>{name === '_extra' ? local('추가 매개변수', 'Additional parameters') : name}</b>: {message}</li>)}</ul></Alert>}
            {pending && <Alert type="info">{local('Proxmox에서 요청을 처리하고 있습니다. 응답을 받은 뒤 작업을 전환하거나 이 화면을 닫으세요.', 'Proxmox is processing this request. Wait for its response before switching operations or closing this page.')}</Alert>}
            <Link external target="_blank" href={`https://pve.proxmox.com/pve-docs/api-viewer/index.html#${operation.path}`}>{local('공식 API 문서', 'Official API documentation')}</Link>
            {!!operation.deprecated && <Alert type="warning">{local('공식 문서에서 사용 중단 예정으로 표시된 작업입니다.', 'This operation is deprecated in the official documentation.')}</Alert>}
            {isWebsocketOperation(operation) ? <Alert type="info">{local('실시간 연결은 가상 머신·컨테이너의 콘솔 또는 노드의 셸 화면에서 시작하세요.', 'Start this live connection from a VM/container console or the node shell page.')}</Alert> : <>
              {required.length > 0 && <Container header={<Header variant="h3">{local('필수 매개변수', 'Required parameters')}</Header>}><SpaceBetween size="l">{required.map(field)}</SpaceBetween></Container>}
              {upload && <FormField label={local('업로드 파일', 'Upload file')} errorText={errors.filename}><FileUpload value={files} onChange={({ detail }) => { if (!pending) setFiles(detail.value); }} showFileSize showFileLastModified i18nStrings={{ uploadButtonText: () => local('파일 선택', 'Choose file'), dropzoneText: () => local('파일을 놓으세요.', 'Drop a file'), removeFileAriaLabel: () => local('파일 제거', 'Remove file'), limitShowFewer: local('간단히 보기', 'Show fewer'), limitShowMore: local('더 보기', 'Show more'), errorIconAriaLabel: local('오류', 'Error') }} /></FormField>}
              {optional.length > 0 && <ExpandableSection headerText={`${local('선택 매개변수', 'Optional parameters')} (${optional.length})`} expanded={optionalOpen} onChange={({ detail }) => setOptionalOpen(detail.expanded)}><SpaceBetween size="l">{optional.map(field)}</SpaceBetween></ExpandableSection>}
              <ExpandableSection expanded={extraOpen} onChange={({ detail }) => setExtraOpen(detail.expanded)} headerText={local('반복 장치 및 추가 매개변수', 'Indexed devices and additional parameters')}>
                <FormField label={local('매개변수', 'Parameters')} description={local('net[n], scsi[n] 같은 반복 필드는 net0, scsi0처럼 번호를 지정합니다. 공식 매개변수만 허용합니다. 빈 문자열을 명시하려면 {"comment":""}처럼 입력하세요.', 'For indexed fields such as net[n] or scsi[n], use net0 or scsi0. Only documented parameters are accepted. Use {"comment":""} to explicitly send an empty string.')} errorText={errors._extra}>
                  <Textarea ref={instance => { inputs.current._extra = instance; }} value={extra} onChange={({ detail }) => { setExtra(detail.value); setErrors(current => { const next = { ...current }; delete next._extra; return next; }); }} rows={5} disabled={pending} />
                </FormField>
                {properties.filter(([name]) => name.includes('[n]')).map(([name, definition]) => <Box key={name} margin={{ top: 's' }}>{name}: {definition.description}</Box>)}
              </ExpandableSection>
            </>}
            <ExpandableSection headerText={local('필요 권한 및 반환 형식', 'Permissions and response format')}><Textarea readOnly value={format({ permissions: operation.permissions, returns: operation.returns })} rows={8} ariaLabel={local('API 권한과 응답 명세', 'API permissions and response schema')} /></ExpandableSection>
          </SpaceBetween>
        </Form>
      </form>
      {result && <Container header={<Header actions={<SpaceBetween size="xs" direction="horizontal"><Button onClick={() => { setResult(null); setReveal(false); }}>{local('응답 지우기', 'Clear response')}</Button><Button onClick={() => setReveal(value => !value)}>{reveal ? local('민감한 값 숨기기', 'Hide sensitive values') : local('민감한 값 표시', 'Reveal sensitive values')}</Button></SpaceBetween>}>{local('응답', 'Response')}</Header>}>
        <SpaceBetween size="m"><Alert type={result.task ? 'info' : 'success'}>{result.task ? local('작업이 접수됐습니다. 완료 상태는 알림에서 확인하세요.', 'Task accepted. Follow its completion in notifications.') : local('요청이 처리됐습니다.', 'Request completed.')}</Alert><Textarea readOnly value={format(reveal ? result.data : redactApiData(result.data, true))} rows={14} ariaLabel={local('API 응답', 'API response')} /></SpaceBetween>
      </Container>}
      {download && <Alert type="success" action={<Button href={download.url} download={download.filename}>{local('파일 저장', 'Save file')}</Button>}>{local('응답 파일을 저장할 수 있습니다.', 'The response file is ready to save.')}</Alert>}
      {confirm && <Modal visible closeAriaLabel={local('대화 상자 닫기', 'Close dialog')} onDismiss={() => setConfirm(false)} header={local('변경 요청 검토', 'Review change request')} size="large" footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setConfirm(false)}>{local('취소', 'Cancel')}</Button><Button variant="primary" onClick={() => { if (operation.method === 'DELETE' && phrase !== prepared.path) { setErrors(current => ({ ...current, _confirm: local('경로가 일치하지 않습니다.', 'The path does not match.') })); return; } void execute(); }}>{operation.method === 'DELETE' ? local('삭제', 'Delete') : local('실행', 'Execute')}</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m"><Alert type="warning">{local('이 요청은 Proxmox의 실제 설정이나 리소스를 변경합니다. 경로와 값을 확인하세요.', 'This request changes real Proxmox configuration or resources. Verify the path and values.')}</Alert><Box fontWeight="bold">{operation.method} {prepared.path}</Box><Textarea readOnly value={format(redactApiData(prepared.values))} rows={8} ariaLabel={local('변경할 값', 'Requested values')} />{upload && <Box>{files[0]?.name} ({files[0]?.size} bytes)</Box>}{operation.method === 'DELETE' && <FormField label={local('삭제할 경로를 그대로 입력하세요.', 'Enter the exact path to delete.')} description={prepared.path} errorText={errors._confirm}><Input value={phrase} onChange={({ detail }) => setPhrase(detail.value)} autoFocus /></FormField>}</SpaceBetween>
      </Modal>}
      {leaveUrl && <Modal visible closeAriaLabel={local('대화 상자 닫기', 'Close dialog')} onDismiss={() => setLeaveUrl(null)} header={local('이 화면에서 나가시겠습니까?', 'Leave this page?')} footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setLeaveUrl(null)}>{local('계속 편집', 'Keep editing')}</Button><Button variant="primary" onClick={() => { approvedNavigation.current = true; window.location.assign(leaveUrl); }}>{local('변경 사항 버리고 나가기', 'Discard and leave')}</Button></SpaceBetween></Box>}>
        {local('입력한 값과 응답이 사라집니다. 비밀 값과 응답 파일을 먼저 보관하세요.', 'Entered values and responses will be removed. Save secrets and response files first.')}
      </Modal>}
    </SpaceBetween>
  </div>;
}
