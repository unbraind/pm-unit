import { devNull } from 'node:os';

/** Copy an environment without Git overrides, including Windows spelling variants. */
export function gitEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^GIT_/i.test(key)));
}

/** Remove all npm policy/config variants before setting one isolated user config. */
export function npmEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !/^npm_config_(allow_scripts|userconfig|registry|_auth|username)$/i.test(key) && !/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|(?:^|_)KEY(?:_|$)|(?:^|_)AUTH(?:_|$)|NPM_MEDIA_SERVER)/i.test(key))), npm_config_userconfig: devNull, npm_config_registry: 'https://registry.npmjs.org' };
}

/** Clear inherited test-runner context without losing subprocess coverage instrumentation. */
export function testEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^NODE_TEST_CONTEXT$/i.test(key)));
}
