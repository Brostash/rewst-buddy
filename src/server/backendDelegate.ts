/** HTTP ownership supplied by the backend's connect-or-start lifecycle. */
export interface BackendServerDelegate {
	start(): Promise<boolean>;
	stop(): Promise<void>;
	getStatus(): boolean;
}
let delegate: BackendServerDelegate | undefined;
export function getBackendServerDelegate(): BackendServerDelegate | undefined {
	return delegate;
}
export function setBackendServerDelegate(value: BackendServerDelegate | undefined): void {
	delegate = value;
}
