import * as migration_20260815_191908_init from './20260815_191908_init';
import * as migration_20260816_215142 from './20260816_215142';

export const migrations = [
  {
    up: migration_20260815_191908_init.up,
    down: migration_20260815_191908_init.down,
    name: '20260815_191908_init',
  },
  {
    up: migration_20260816_215142.up,
    down: migration_20260816_215142.down,
    name: '20260816_215142'
  },
];
