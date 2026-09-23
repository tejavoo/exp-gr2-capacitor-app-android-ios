import tailwindcss from '@tailwindcss/postcss'

/**
 * Tailwind v4 wraps everything in cascade layers (@layer). Web views older than
 * Chrome 99 / Safari 15.4 ignore @layer blocks entirely, which leaves the app unstyled
 * (iOS 15.0–15.3 can't update its WebKit; old Android System WebViews exist too).
 * Tailwind emits its layers in cascade order and our own CSS comes after them, so
 * unwrapping the blocks in place keeps the same result on modern engines.
 */
const flattenCascadeLayers = () => ({
  postcssPlugin: 'flatten-cascade-layers',
  OnceExit(root) {
    let found = true
    while (found) {
      found = false
      root.walkAtRules('layer', rule => {
        found = true
        if (rule.nodes && rule.nodes.length) rule.replaceWith(rule.nodes)
        else rule.remove()
      })
    }
  },
})
flattenCascadeLayers.postcss = true

export default {
  plugins: [tailwindcss(), flattenCascadeLayers()],
}
