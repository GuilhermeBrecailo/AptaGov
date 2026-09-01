import { loadEnv } from '../src/config/env';
import { createDatabase } from '../src/db/database';
import { createDatabaseBackup } from '../src/services/backupService';

const env = loadEnv();
const db = createDatabase(env.databaseUrl);
const path = createDatabaseBackup(db, env.databaseUrl);
db.close();
console.log(`Backup criado em ${path}`);
