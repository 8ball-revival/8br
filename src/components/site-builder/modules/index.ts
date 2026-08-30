/**
 * Loading the registry.
 *
 * Registration happens as a side effect of importing a module file, so SOMETHING has to import them
 * all before the first render, validation or palette read. That something is this file, and every
 * entry point into the builder imports it rather than reaching for an individual module.
 *
 * The alternative — each consumer importing the modules it expects — is how a page ends up
 * validating against half a registry: the renderer knows about a type, the validator does not, and
 * a perfectly good module is reported as unknown depending on which file was loaded first.
 *
 * Import order does not matter. `registerModule` throws on a duplicate type rather than letting the
 * later import quietly win, so a collision is a startup error rather than a rendering mystery.
 */

import './content'
import './registry-data'
import './registry-home'
import './marquee'
import './global'
import './system'
import './layout'
import './content-extra'
import './competitions'
import './shell'

export { }
