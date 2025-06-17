
export type RewstProfiles = Record<string, RewstProfile>;

export default interface RewstProfile {
    orgId: string;
    loaded: boolean;
    label: string;
};// commands/index.ts
