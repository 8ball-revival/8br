import * as migration_20260815_191908_init from './20260815_191908_init';
import * as migration_20260816_215142 from './20260816_215142';
import * as migration_20260817_210000_remove_rules from './20260817_210000_remove_rules';

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
  {
    up: migration_20260817_210000_remove_rules.up,
    down: migration_20260817_210000_remove_rules.down,
    name: '20260817_210000_remove_rules',
  },
];
