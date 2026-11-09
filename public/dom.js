// @ts-check

/**
 * @typedef {object} Props
 * @property {string} [class]
 * @property {string} [text]
 * @property {Record<string, string>} [attrs]
 */

/** @typedef {Node | string | null | undefined | false} Child */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds an element. Text is always added as text and never as HTML,
 * so words from a resume or a job ad cannot run code.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Props} [props]
 * @param {Child[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  if (props.text !== undefined) element.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) element.setAttribute(name, value);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

/**
 * Builds an SVG element.
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {SVGElement[]} [children]
 * @returns {SVGElement}
 */
export function svg(tag, attrs = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
