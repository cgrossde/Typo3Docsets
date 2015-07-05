# Typo3Docsets

This script creates `.docset` files for multiple Typo3 CMS and Typo3 FLOW versions. If you have problems/improvements with/for this script or the docsets please open an issue.

The search keys to be used in Dash/Velocity/Zeal have the following schema:

* `t3:` - Typo3 master
* `t3-62:` - Typo3 6.3.x
* `t3-45:` - Typo3 4.5.x
* `t3f:` - Typo3 FLOW master
* `t3f-23:` - Typo3 FLOW 2.3.x
* ...

## Prerequisites

* Mac OS with XCode installed (`docsetutil`)
* `doxygen`  (`brew install doxygen`)
* `git`

## Generating docsets

Just execute `./docgen cms` or `./docgen flow` to generate the desired docsets. Modify `config.json` to add new versions or only generate / update certain versions.

## Logs

I added the log files of the creation process to this git under `logs/`. If you have issues with a certain docset a look at those might prove helpful.
