import { log } from '@log';

/**
 * Type guard function signature for runtime type checking
 */
export type TypeGuard<T> = (value: unknown) => value is T;

/**
 * Utility functions for validating and extracting command arguments
 */
export class CommandValidator {
	/**
	 * Validates command arguments and extracts a typed entry from the first argument array
	 *
	 * @param args - Command arguments array
	 * @param constructor - Constructor function to validate against
	 * @param contextName - Context name for error logging (e.g., "DeleteTemplate")
	 * @param typeName - Human-readable type name for error messages (e.g., "template")
	 * @returns The validated and typed entry
	 * @throws Error if validation fails
	 */
	static validateAndExtract<T>(
		args: unknown[],
		constructor: new (...args: any[]) => T,
		contextName: string,
		typeName: string,
	): T {
		if (!Array.isArray(args) || args.length === 0) {
			const message = `${contextName}: No arguments provided`;
			log.error(message, true);
			throw new Error(`No ${typeName} selected`);
		}

		const firstArg = args[0];
		if (!Array.isArray(firstArg) || firstArg.length === 0) {
			const message = `${contextName}: Invalid argument structure`;
			log.error(message, true);
			throw new Error(`Invalid ${typeName} selection`);
		}

		const entry = firstArg[0];
		if (!(entry instanceof constructor)) {
			const message = `${contextName}: Invalid entry type: ${typeof entry}`;
			log.error(message, true);
			throw new Error(`Cannot process something that is not a ${typeName}`);
		}

		log.info(
			`${contextName}: Validated ${typeName} for processing: ${(entry as any)?.label || 'unknown'} (${(entry as any)?.id || 'unknown'})`,
		);
		return entry;
	}

	/**
	 * Validates command arguments and extracts a typed entry using a custom type guard
	 *
	 * @param args - Command arguments array
	 * @param typeGuard - Type guard function to validate the entry type
	 * @param contextName - Context name for error logging
	 * @param typeName - Human-readable type name for error messages
	 * @returns The validated and typed entry
	 * @throws Error if validation fails
	 */
	static validateAndExtractWithGuard<T>(
		args: unknown[],
		typeGuard: TypeGuard<T>,
		contextName: string,
		typeName: string,
	): T {
		if (!Array.isArray(args) || args.length === 0) {
			const message = `${contextName}: No arguments provided`;
			log.error(message, true);
			throw new Error(`No ${typeName} selected`);
		}

		const firstArg = args[0];
		if (!Array.isArray(firstArg) || firstArg.length === 0) {
			const message = `${contextName}: Invalid argument structure`;
			log.error(message, true);
			throw new Error(`Invalid ${typeName} selection`);
		}

		const entry = firstArg[0];
		if (!typeGuard(entry)) {
			const message = `${contextName}: Invalid entry type: ${typeof entry}`;
			log.error(message, true);
			throw new Error(`Cannot process something that is not a ${typeName}`);
		}

		log.info(
			`${contextName}: Validated ${typeName} for processing: ${(entry as any)?.label || 'unknown'} (${(entry as any)?.id || 'unknown'})`,
		);
		return entry;
	}

	/**
	 * Validates that the provided value is an instance of the specified class
	 *
	 * @param value - Value to check
	 * @param constructor - Constructor function to check against
	 * @returns Type guard result
	 */
	static isInstanceOf<T>(constructor: new (...args: any[]) => T): TypeGuard<T> {
		return (value: unknown): value is T => value instanceof constructor;
	}

	/**
	 * Validates command arguments and extracts multiple typed entries from the first argument array
	 *
	 * @param args - Command arguments array
	 * @param typeGuard - Type guard function to validate entry types
	 * @param contextName - Context name for error logging
	 * @param typeName - Human-readable type name for error messages
	 * @param minCount - Minimum number of entries required (default: 1)
	 * @returns Array of validated and typed entries
	 */
	static validateAndExtractMultiple<T>(
		args: unknown[],
		typeGuard: TypeGuard<T>,
		contextName: string,
		typeName: string,
		minCount = 1,
	): T[] {
		if (!Array.isArray(args) || args.length === 0) {
			const message = `${contextName}: No arguments provided`;
			log.error(message, true);
			throw new Error(`No ${typeName}s selected`);
		}

		const firstArg = args[0];
		if (!Array.isArray(firstArg) || firstArg.length < minCount) {
			const message = `${contextName}: Invalid argument structure or insufficient entries (need at least ${minCount})`;
			log.error(message, true);
			throw new Error(
				`Invalid ${typeName} selection - need at least ${minCount} ${typeName}${minCount > 1 ? 's' : ''}`,
			);
		}

		const validEntries: T[] = [];
		const invalidEntries: unknown[] = [];

		for (const entry of firstArg) {
			if (typeGuard(entry)) {
				validEntries.push(entry);
			} else {
				invalidEntries.push(entry);
			}
		}

		if (validEntries.length < minCount) {
			const message = `${contextName}: Insufficient valid entries (${validEntries.length}/${minCount})`;
			log.error(message, true);
			throw new Error(`Need at least ${minCount} valid ${typeName}${minCount > 1 ? 's' : ''}`);
		}

		if (invalidEntries.length > 0) {
			log.info(`${contextName}: Filtered out ${invalidEntries.length} invalid entries`);
		}

		log.info(
			`${contextName}: Validated ${validEntries.length} ${typeName}${validEntries.length > 1 ? 's' : ''} for processing`,
		);
		return validEntries;
	}
}
