// Lets plain TypeScript (typescript-eslint's type information) type `.vue` imports.
// vue-tsc resolves the real component types and ignores this shim.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
