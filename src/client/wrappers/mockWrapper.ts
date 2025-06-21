import { SdkFunctionWrapper } from "@sdk";
import { log } from '@log';

export function createMockWrapper(): SdkFunctionWrapper {
  return async <T>(action: (requestHeaders?: Record<string, string>) => Promise<T>, operationName: string): Promise<T> => {
    log.info(`Mock wrapper intercepted operation: ${operationName}`);
    
    // For testing, we can provide mock responses based on operation name
    if (operationName === 'UserOrganization') {
      return {
        userOrganization: {
          id: 'mock-org-id',
          name: 'Mock Organization'
        }
      } as T;
    }
    
    // For other operations, execute normally in test environment
    return await action();
  };
}