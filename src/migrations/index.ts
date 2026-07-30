import * as migration_20260730_171420_initial from './20260730_171420_initial';

export const migrations = [
  {
    up: migration_20260730_171420_initial.up,
    down: migration_20260730_171420_initial.down,
    name: '20260730_171420_initial'
  },
];
