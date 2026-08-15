import * as migration_20260815_191908_init from './20260815_191908_init';

export const migrations = [
  {
    up: migration_20260815_191908_init.up,
    down: migration_20260815_191908_init.down,
    name: '20260815_191908_init'
  },
];
