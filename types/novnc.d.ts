declare module "novnc" {
  interface RFBOptions {
    wsProtocols?: string[];
    credentials?: { password?: string };
    shared?: boolean;
  }

  class RFB {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RFBOptions);
    scaleViewport: boolean;
    resizeSession: boolean;
    qualityLevel: number;
    compressionLevel: number;
    viewOnly: boolean;
    addEventListener(type: "connect", listener: () => void): void;
    addEventListener(type: "disconnect", listener: (e: { detail: { clean: boolean; reason?: string } }) => void): void;
    addEventListener(type: "credentialsrequired", listener: () => void): void;
    removeEventListener(type: "connect", listener: () => void): void;
    removeEventListener(type: "disconnect", listener: (e: { detail: { clean: boolean; reason?: string } }) => void): void;
    removeEventListener(type: "credentialsrequired", listener: () => void): void;
    disconnect(): void;
    sendCredentials(credentials: { password: string }): void;
  }

  export default RFB;
}
