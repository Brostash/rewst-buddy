import { log } from '@utils';
import { Server } from '@server';
import { getSharedConnection } from '../../backend/sharedConnection';
import GenericCommand from '../GenericCommand';

export class StopServer extends GenericCommand {
	commandName = 'StopServer';

	async execute(): Promise<void> {
		if (!Server.getStatus()) {
			log.notifyInfo('Server is not running');
			return;
		}

		await Server.stop();
		log.notifyInfo(
			getSharedConnection()?.owned === false
				? 'The shared server is owned by another process. Stop it in that process when you are finished.'
				: 'Server stopped',
		);
	}
}
