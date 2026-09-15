const { existsSync: fsExistsSync, promises: fsPromises } = require("fs");
const { basename: pathBasename, join: pathJoin } = require("path");

function existsSync(absPath) {
  return Boolean(fsExistsSync(absPath));
}

function basename(absPath) {
  return String(pathBasename(absPath));
}

function joinPaths(left, right) {
  return String(pathJoin(left, right));
}

async function readDirEntries(absPath) {
  const names = await fsPromises.readdir(absPath, { withFileTypes: true });
  return names.map((entry) => ({
    name: String(entry.name),
    isDirectory: Boolean(entry.isDirectory()),
  }));
}

module.exports = {
  existsSync,
  basename,
  joinPaths,
  readDirEntries,
};
