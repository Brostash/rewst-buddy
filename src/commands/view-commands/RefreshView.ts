import { view } from '@global';
import { log } from '@log';
import GenericCommand from '../GenericCommand';

export class RefreshView extends GenericCommand {
	commandName = 'RefreshView';

	async execute(...args: any): Promise<unknown> {
		const entry = args[0][0] ?? undefined;
		view.refresh(entry);
		log.info(`Refreshed View`, true);
		return;
	}
}
