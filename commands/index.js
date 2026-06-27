const remind = require('./remind');
const remindDefault = require('./remindDefault');
const reminders = require('./reminders');
const remindersRange = require('./remindersRange');
const remindEdit = require('./remindEdit');
const remindDelete = require('./remindDelete');
const remindImport = require('./remindImport');
const help = require('./help');

const commandModules = [
  remind,
  remindDefault,
  reminders,
  remindersRange,
  remindEdit,
  remindDelete,
  remindImport,
  help,
];

const commands = new Map(commandModules.map((command) => [command.name, command]));

module.exports = { commands };
