import type { SharedServerDescriptor } from '../../packages/mcp-server/src/sharedDiscovery';
let shared: { descriptor: SharedServerDescriptor; owned: boolean; rotate?: (token: string) => void } | undefined;
export function setSharedConnection(value: typeof shared): void {
	shared = value;
}
export function getSharedConnection() {
	return shared;
}
export function assertCanRotateSharedToken(): void {
	if (shared && !shared.owned)
		throw new Error(
			'This window is attached to an existing Rewst Buddy server. Rotate its token in the owning process.',
		);
}
export function updateSharedToken(token: string): void {
	if (shared) {
		shared.descriptor.publicToken = token;
		shared.rotate?.(token);
	}
}
