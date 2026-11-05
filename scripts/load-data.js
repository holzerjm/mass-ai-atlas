/* Node side of the shared loader (../atlas-data.js): reads data/*.yml and
   their schemas from disk.
     const { CATS, STAGES, DATA } = require("./load-data").loadData();   // throws on schema errors */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Ajv = require("ajv");
const { FILES, parseAtlas, loadAtlas } = require("../atlas-data.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const readTexts = () =>
  Object.fromEntries(FILES.map(f => [f, fs.readFileSync(path.join(DATA_DIR, f), "utf8")]));

// data/pathways.yml is not part of the atlas's required files: the page reads it on its own
// and works without it, so atlas-data.js never loads it. validate.js checks it against its schema.
const readYaml = f => yaml.load(fs.readFileSync(path.join(DATA_DIR, f), "utf8"), { schema: yaml.CORE_SCHEMA, filename: f });

module.exports = {
  DATA_DIR,
  loadData: () => loadAtlas(readTexts(), yaml, Ajv),
  checkData: () => parseAtlas(readTexts(), yaml, Ajv),
  loadPathways: () => readYaml("pathways.yml"),
};
