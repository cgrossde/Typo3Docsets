/*global cd, exec, which, echo, exit, mkdir, mv, cp*/
'use strict';
var fs = require('fs');
require('shelljs/global');
var del = require('del');
var path = require('path');
var semver = require('semver');
var Promise = require('promise');
var tplEngine = require('swig');
tplEngine.setDefaults({ loader: tplEngine.loaders.fs(__dirname) });

/**
 * Exposed generation method. Orchestrates .docset generation, even for multiple
 * versions.
 *
 * @param  {object} config
 * @param  {undefined|string} specificVersion
 */
function gen(config, specificVersion) {
  // Check prequesites
  if (!which('git')) {
    echo('Sorry, this script requires git');
    exit(1);
  }
  if (!which('doxygen')) {
    echo('Sorry, this script requires doxygen');
    exit(1);
  }

  // Init GIT
  initGit(config.git, config.gitDir);
  // Start docset generation for each enabled version
  config.versions.filter(function(version) {
    // Only process versions that have an update flag and are enabled
    return (version.enabled && version.update);
  })
  .forEach(function(version, index) {
    // If there is a specific version we want and this
    // is not this specific version then we skip
    if (specificVersion !== undefined && version.version !== specificVersion) {
      return;
    }
    console.log('#');
    console.log('# Start docset ' + config.name + ' @ ' + version.version + ' (' + version.dashVersion + ')');
    console.log('#');
    buildDocset(version, config);
  });

  console.log('-------------------');
  console.log('All docsets generated.');
  console.log('Update docset.json');
  updateDocsetJson(config);
  console.log('Copy icon and readme.');
  var docsetRoot = path.join(__dirname, 'dist', config.name);
  var resPath = path.join(__dirname, 'res');
  cp('-f', path.join(resPath, 'README.md'), docsetRoot);
  cp('-f', path.join(resPath, config.iconName + '.png'), path.join(docsetRoot, 'icon.png'));
  cp('-f', path.join(resPath, config.iconName + '@2x.png'), path.join(docsetRoot, 'icon@2x.png'));
  console.log('');
  console.log('DONE :)');
}

/**
 * Create .docset file
 *
 * @param  {object} version Contains git ref, version info, search key, ...
 * @param  {object} config  Contains overall config
 */
function buildDocset(version, config) {
  // Checkout branch or tag
  var gitPath = path.join(__dirname, 'src', config.gitDir);
  var tmpPath = path.join(__dirname, 'tmp');
  // Checkout ref
  console.log('Checkout ref ...');
  cd(gitPath);
  var cmd = exec('git checkout ' + version.ref + ' 2>&1');
  if (cmd.code !== 0) {
    console.log('Could not checkout ref for ' + config.name + ' @ '
      + version.version + ' (Ref: ' + version.ref + ')');
    exit(1);
  }

  // Setup tmp
  console.log('Setup tmp: ', tmpPath);
  if (fs.existsSync(tmpPath)) {
    del.sync(tmpPath, { force: true });
  }
  mkdir(tmpPath);

  // Configure doxygen
  console.log('Configure doxygen');
  configureDoxygen(tmpPath, gitPath, version, config);
  // Execute doxygen
  var doxygenLogFile = path.join(__dirname, 'logs', 'doxygen_' + config.name + '_' + version.version + '.log');
  console.log('Exec doxygen ...');
  console.log('You can watch the progress with: tail -f ' + doxygenLogFile);
  cd(__dirname);
  var doxygenCmd = exec('doxygen tmp/doxygen.conf >> ' + doxygenLogFile + ' 2>&1');
  if (doxygenCmd.code !== 0) {
    console.log('Doxygen failed for ' + config.name + ' @ '
      + version.version + ' (Ref: ' + version.ref + ')');
    exit(1);
  }

  // Generate docset
  var docesetLogPath = path.join(__dirname, 'logs', 'docset_' + config.name + '_' + version.version + '.log');
  console.log('Generate docset ... (this takes half an hour or more)');
  console.log('You can watch the progress with: tail -f ' + docesetLogPath);
  var doxygenPath = path.join(tmpPath, 'html');
  cd(doxygenPath);
  // Execute make
  var docsetCmd = exec('make docset >> ' + docesetLogPath + ' 2>&1');
  if (docsetCmd.code !== 0) {
    console.log('Docset generation failed for ' + config.name + ' @ '
      + version.version + ' (Ref: ' + version.ref + ')');
    exit(1);
  }
  console.log('Docset done!');
  console.log('Rename and compress docset ...');

  // Change search key (t3-46: to switch to a specific docset)
  var docsetPath = path.join(tmpPath, 'html', config.bundleId + '.docset');
  var plistFilePath = path.join(docsetPath, 'Contents', 'Info.plist');
  var plistCmd = exec('plutil -replace DocSetPlatformFamily -string ' + version.searchKey + ' ' + plistFilePath);
  var newDocSetPath = path.join(tmpPath, 'html', config.name + '.docset');
  // Rename docset
  mv(docsetPath, newDocSetPath);
  var compressedDocsetPath = path.join(tmpPath, 'html', config.bundleId + '.tgz');
  // Compress docset
  cd(newDocSetPath + '/..');
  var compressCmd = exec("tar --exclude='.DS_Store' -czf " + config.name + '.tgz ' + config.name + '.docset');
  if (compressCmd.code !== 0) {
    console.log('Compressing failed: ' + compressCmd.output);
    exit(1);
  }
  // Move docset
  moveDocsetToDist(compressedDocsetPath, config, version);
  console.log('#');
  console.log('# Docset creation done and moved to dist');
  console.log('#');
}

/**
 * Clone or open and update repo
 *
 * @param  {string} gitUrl
 * @param  {string} gitDir
 * @return {Repository}
 */
function initGit(gitUrl, gitDir) {
  var srcPath = path.join(__dirname, 'src');
  var gitPath = path.join(srcPath, gitDir);
  var cmd;

  // Check if repo exists
  if (fs.existsSync(gitPath)) {
    console.log('Found repo -> git fetch ...');
    // Update repo
    cd(gitPath);
    //cmd = exec('git fetch 2>&1');
    cmd = { code: 0};
  }
  else {
    console.log('No repo found -> git clone ...');
    // Clone repo
    cd(srcPath);
    cmd = exec('git clone ' + gitUrl + ' 2>&1');
  }
  // Did we succed?
  if (cmd.code !== 0) {
    console.log('initGit failed', cmd.output);
    exit(1);
  }
}

/**
 * Move docset to correct dist path
 * Create necessary paths along the way
 *
 * @param  {string} docsetPath
 * @param  {object} config
 * @param  {object} version
 */
function moveDocsetToDist(docsetPath, config, version) {
  var docsetVersionsPath = path.join(__dirname, 'dist', config.name, 'versions', version.version);
  var newDocSetPath = path.join(docsetVersionsPath, config.name + '.tgz');
  // Create dir
  mkdir('-p', docsetVersionsPath);
  // Remove old version if necessary
  if (fs.existsSync(newDocSetPath)) {
    del.sync(newDocSetPath, { force: true });
  }
  // Move docset to new location
  mv(docsetPath, newDocSetPath);
}

/**
 * Create configuration file for doxygen
 *
 * @param  {string} tmpPath Path to temporay folder for doxygen output
 * @param  {string} gitPath Path to git repo with doxygen input
 * @param  {object} version
 * @param  {object} config
 */
function configureDoxygen(tmpPath, gitPath, version, config) {
  var doxygenConfFile = path.join(__dirname, 'tmp', 'doxygen.conf');
  var doxygenConfTemplate = path.join(__dirname, 'doxygen.conf.tpl');
  // Delete old conf file?
  if (fs.existsSync(doxygenConfFile)) {
    del.sync(doxygenConfFile, { force: true });
  }
  // Use template to create new doxygen file
  var tpl = tplEngine.compileFile(doxygenConfTemplate);
  var tplValues = {
    title: config.name,
    bundleId: config.bundleId,
    version: version.version,
    outputPath: tmpPath,
    inputPath: gitPath,
    excludePaths: getExcludePaths(config, version, gitPath),
    excludePatterns: config.excludePatterns.join(' \\\n')
  };
  // Compile template and write to file
  var tplCompiled = tpl(tplValues, { autoescape: false });
  // Write to file
  try {
    fs.writeFileSync(doxygenConfFile, tplCompiled);
  }
  catch(err) {
    console.log('Could not write doxygen file: ', err);
    console.log(err.stack);
  }
}

/**
 * Calc exclude paths depending on version (uses semver)
 *
 * @param  {object} config
 * @param  {object} version
 * @param  {string} gitPath Path to git repo
 */
function getExcludePaths(config, version, gitPath) {
  if (config.excludePaths.length === 0) {
    return '';
  }
  var excludeArray = [];
  config.excludePaths.forEach(function(excludeObj) {
    // Do these exclude paths apply for this version?
    if ((excludeObj.versionRange === 'x' && version.version === 'master')
      || ( semver.valid(version.version) && semver.satisfies(version.version, excludeObj.versionRange)) ) {
      // Prefix each path and add it to exclude array
      excludeObj.excludes.forEach(function(excludePath) {
        excludeArray.push(path.join(gitPath, excludePath));
      });
    }
  });
  return excludeArray.join(' \\\n');
}

function updateDocsetJson(config) {
  var docsetRoot = path.join(__dirname, 'dist', config.name);
  // Create specific versions array from enabled versions
  var specificVersions = [];
  config.versions.filter(function(version) {
    return version.enabled;
  })
  .forEach(function(version, index) {
    // Is this the stable version?
    if (version.version === config.stable) {
      // Copy it to root
      var stableDocset = path.join(docsetRoot, 'versions', version.version, config.name + '.tgz');
      cp('-f', stableDocset, docsetRoot);
    }
    specificVersions.push({
      version: version.dashVersion,
      archive: 'versions/' + version.version + '/' + config.name + '.tgz'
    });
  });
  // Put everything together
  var docset = {
    name: config.name,
    version: config.stable,
    archive: config.name + '.tgz',
    author: {
      name: 'Christoph Gross',
      link: 'https://github.com/cgrossde/Typo3Docsets'
    },
    aliases: config.aliases,
    specific_versions: specificVersions
  };
  // Write to file
  var docsetJson = JSON.stringify(docset, null, 2);
  var docsetPath = path.join(docsetRoot, 'docset.json');
  fs.writeFileSync(docsetPath, docsetJson);
}

module.exports.gen = gen;
