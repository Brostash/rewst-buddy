import { context } from '@global';
import { log } from '@log';
import { getSdk, Sdk, SdkFunctionWrapper } from '@sdk';
import { GraphQLClient } from 'graphql-request';
import vscode from 'vscode';
import { getRegionConfigs, RegionConfig } from './RegionConfig';
import RewstProfile, { RewstProfiles } from './RewstProfiles';
import { createMockWrapper, createRetryWrapper } from './wrappers';

function parseCookieString(cookieString: string): Record<string, string> {
	const cookies: Record<string, string> = {};

	cookieString.split(';').forEach(pair => {
		const trimmedPair = pair.trim();
		const [key, value] = trimmedPair.split('=');

		if (key && value) {
			cookies[key] = value;
		}
	});

	return cookies;
}

export default class RewstClient {
	private secrets: vscode.SecretStorage;

	private constructor(
		context: vscode.ExtensionContext,
		public sdk: Sdk,
		public orgId: string,
		public label: string,
		public region: RegionConfig,
	) {
		this.secrets = context.secrets;
		this.saveProfile();
	}

	static async create(context: vscode.ExtensionContext, orgId?: string, token?: string): Promise<RewstClient> {
		// Guard clause: Get token if not provided
		if (!token) {
			token = await RewstClient.getTokenForCreation(context, orgId);
		}

		if (typeof token !== 'string') {
			log.error('Retrieved token is not a string', true);
			throw new Error('Invalid token format');
		}

		const [sdk, regionConfig] = await RewstClient.newSdk(token);

		const response = await sdk.UserOrganization();
		const org = response.userOrganization;

		if (typeof org?.id !== 'string') {
			log.error('Failed to retrieve organization ID from API', true);
			throw new Error('Invalid organization data');
		}

		await context.secrets.store(org.id, token);
		const client = new RewstClient(context, sdk, org.id, org.name, regionConfig);

		await client.refreshToken();

		return client;
	}

	private static async getTokenForCreation(context: vscode.ExtensionContext, orgId?: string): Promise<string> {
		if (!orgId) {
			return await RewstClient.promptToken();
		}

		const token = await context.secrets.get(orgId);
		if (!token) {
			log.error(`No stored token found for orgId: ${orgId}`, true);
			throw new Error('No stored token available');
		}

		return token;
	}

	static async LoadClients(context: vscode.ExtensionContext): Promise<RewstClient[]> {
		const profileObj = RewstClient.getSavedProfiles(context);
		const profiles = Object.values(profileObj);

		const resultsPromises = profiles.map(async profile => {
			try {
				return await RewstClient.create(context, profile.orgId);
			} catch (err) {
				log.error(`Failed to create client for ${profile.orgId}: ${err}`, false);
				return undefined;
			}
		});

		const results = await Promise.all(resultsPromises);

		const clients = results.filter((c): c is RewstClient => c !== undefined);
		log.info(`Successfully loaded ${clients.length} clients`);

		return clients;
	}

	private saveProfile() {
		const profiles = this.getSavedProfiles();
		profiles[this.orgId] = this.getProfile();
		context.globalState.update('RewstProfiles', profiles);
	}

	private static getSavedProfiles(context: vscode.ExtensionContext): RewstProfiles {
		return context.globalState.get<RewstProfiles>('RewstProfiles') ?? {};
	}

	public static clearProfiles(context: vscode.ExtensionContext) {
		context.globalState.update('RewstProfiles', {});
	}

	private getSavedProfiles(): RewstProfiles {
		return RewstClient.getSavedProfiles(context);
	}

	private getProfile(): RewstProfile {
		return { orgId: this.orgId, loaded: false, label: this.label };
	}

	private static newSdkAtRegion(token: string, config: RegionConfig): Sdk {
		const client = new GraphQLClient(config.graphqlUrl, {
			errorPolicy: 'all',
			method: 'POST',
			headers: () => ({
				cookie: `${config.cookieName}=${token}`,
			}),
		});

		// Determine wrapper based on environment/flags
		const wrapper = RewstClient.getWrapper();
		const sdk = getSdk(client, wrapper);
		return sdk;
	}

	private static async newSdk(token: string): Promise<[Sdk, RegionConfig]> {
		const configs = getRegionConfigs();
		let sdk;
		let myConfig;
		for (const config of configs) {
			try {
				sdk = RewstClient.newSdkAtRegion(token, config);
				if (!(await RewstClient.validateSdk(sdk))) {
					log.error('SDK validation failed with provided token');
					throw new Error('Invalid SDK configuration');
				}
				myConfig = config;
				break;
			} catch {
				continue;
			}
		}
		if (!sdk) {
			log.error('Could not initialize client with any known region');
			throw new Error('');
		}

		if (!myConfig) {
			log.error('Could not initialize client with any known region');
			throw new Error('');
		}
		return [sdk, myConfig];
	}

	private static getWrapper(): SdkFunctionWrapper | undefined {
		// Check for test/mock environment
		if (process.env.NODE_ENV === 'test' || process.env.REWST_MOCK === 'true') {
			return createMockWrapper();
		}

		// Default to retry wrapper for production
		return createRetryWrapper();
	}

	private static async validateSdk(sdk: Sdk): Promise<boolean> {
		try {
			const response = await sdk.UserOrganization();
			return typeof response.userOrganization?.id === 'string';
		} catch (error) {
			log.error(`SDK validation failed: ${error}`, true);
			return false;
		}
	}

	private static async promptToken(): Promise<string> {
		const token = await vscode.window.showInputBox({
			placeHolder: 'Enter your token',
			prompt: 'We need your token to proceed',
			password: true,
		});

		return token ?? '';
	}

	private async refreshToken() {
		const config = this.region;
		try {
			const oldToken = await this.getToken();

			const response = await fetch(config.loginUrl, {
				method: 'GET',
				headers: {
					cookie: `${config.cookieName}=${oldToken}`,
				},
			});

			if (!response.ok) {
				log.error(`Token refresh request failed with status: ${response.status}`, true);
				throw new Error(`HTTP ${response.status}: Token refresh failed`);
			}

			const cookieString = response.headers.get('set-cookie');
			if (!cookieString) {
				log.error('Token refresh response missing set-cookie header', true);
				throw new Error('Authentication response missing cookies');
			}

			const cookies = parseCookieString(cookieString);
			const appSession = cookies[config.cookieName];

			if (typeof appSession !== 'string') {
				log.error('New session token not found in response cookies', true);
				throw new Error('Invalid session token format');
			}

			const sdk = RewstClient.newSdkAtRegion(appSession, config);
			if (!(await RewstClient.validateSdk(sdk))) {
				log.error('Refreshed token failed SDK validation', true);
				throw new Error('Refreshed token validation failed');
			}

			await this.secrets.store(this.orgId, appSession);
			this.sdk = sdk;
			log.info(`Successfully refreshed token for ${this.orgId}`);
		} catch (error) {
			log.error(`Token refresh failed for ${this.orgId}: ${error}`, true);
			throw error;
		}
	}

	private static async getToken(context: vscode.ExtensionContext, orgId: string): Promise<string> {
		const token = await context.secrets.get(orgId);

		if (typeof token !== 'string') {
			log.error(`Failed to retrieve token for orgId: ${orgId}`, true);
			throw new Error(`No valid token found for organization: ${orgId}`);
		}

		return token;
	}

	async getToken(): Promise<string> {
		return await RewstClient.getToken(context, this.orgId);
	}
}
