var Events = require('../lib/Events.js');

import {equal} from '../lib/utils.js';

/**
 * Update a component.
 *
 * @param {Element} entity - Entity to modify.
 * @param {string} component - Name of the component.
 * @param {string} property - Property name.
 * @param {string|number} value - New value.
 */
export function updateEntity (entity, propertyName, value) {
  if (propertyName.indexOf('.') !== -1) {
    // Multi-prop
    var splitName = propertyName.split('.');
    if (value === null || value === undefined) {
      // Remove property.
      var parameters = entity.getAttribute(splitName[0]);
      delete parameters[splitName[1]];
      entity.setAttribute(splitName[0], parameters);
    } else {
      // Set property.
      entity.setAttribute(splitName[0], splitName[1], value);
    }
  } else {
    if (value === null || value === undefined) {
      // Remove property.
      entity.removeAttribute(propertyName);
    } else {
      // Set property.
      entity.setAttribute(propertyName, value);
    }
  }
  Events.emit('objectchanged', entity.object3D);
}

/**
 * Remove an entity
 * @param  {Element} entity Entity to remove.
 * @param  {boolean} force (Optional) If true it won't ask for confirmation
 */
export function removeEntity (entity, force) {
  if (entity) {
    if (force === true || confirm('Do you really want to remove entity `' + (entity.id || entity.tagName) + '`?')) {
      var closest = findClosestEntity(entity);
      AFRAME.INSPECTOR.removeObject(entity.object3D);
      entity.parentNode.removeChild(entity);
      AFRAME.INSPECTOR.selectEntity(closest);
    }
  }
}

function findClosestEntity (entity) {
  // First we try to find the after the entity
  var nextEntity = entity.nextElementSibling;
  while (nextEntity && (!nextEntity.isEntity || nextEntity.isInspector)) {
    nextEntity = nextEntity.nextElementSibling;
  }

  // Return if we found it
  if (nextEntity && nextEntity.isEntity && !nextEntity.isInspector) {
    return nextEntity;
  }
  // Otherwise try to find before the entity
  var prevEntity = entity.previousElementSibling;
  while (prevEntity && (!prevEntity.isEntity || prevEntity.isInspector)) {
    prevEntity = prevEntity.previousElementSibling;
  }

  // Return if we found it
  if (prevEntity && prevEntity.isEntity && !prevEntity.isInspector) {
    return prevEntity;
  }

  return null;
}

/**
 * Remove the selected entity
 * @param  {boolean} force (Optional) If true it won't ask for confirmation
 */
export function removeSelectedEntity (force) {
  if (AFRAME.INSPECTOR.selectedEntity) {
    removeEntity(AFRAME.INSPECTOR.selectedEntity, force);
  }
}

/**
 * Insert an node after a referenced node.
 * @param  {Element} newNode       Node to insert.
 * @param  {Element} referenceNode Node used as reference to insert after it.
*/
function insertAfter (newNode, referenceNode) {
  if (!referenceNode.parentNode) {
    referenceNode = AFRAME.INSPECTOR.selectedEntity;
  }

  if (!referenceNode) {
    AFRAME.INSPECTOR.sceneEl.appendChild(newNode);
  } else {
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
  }
}

/**
 * Clone an entity, inserting it after the cloned one.
 * @param  {Element} entity Entity to clone
 */
export function cloneEntity (entity) {
  entity.flushToDOM();
  var copy = entity.cloneNode(true);
  copy.addEventListener('loaded', function (e) {
    AFRAME.INSPECTOR.selectEntity(copy);
  });

  // Get a valid unique ID for the entity
  if (entity.id) {
    copy.id = getUniqueId(entity.id);
  }
  copy.addEventListener('loaded', function () {
    Events.emit('dommodified');
    AFRAME.INSPECTOR.selectEntity(copy);
  });
  insertAfter(copy, entity);
}

/**
 * Clone the selected entity
 */
export function cloneSelectedEntity () {
  if (AFRAME.INSPECTOR.selectedEntity) {
    cloneEntity(AFRAME.INSPECTOR.selectedEntity);
  }
}

/**
 * Returns the clipboard representation to be used to copy to the clipboard
 * @param  {Element} entity Entity to copy to clipboard
 * @return {string}        Entity clipboard representation
 */
export function getClipboardRepresentation (entity) {
  var clone = prepareForSerialization(entity);
  clone.flushToDOM(true);
  return clone.outerHTML;
}

/**
 * Returns a copy of the DOM hierarchy prepared for serialization.
 * The process optimises component representation to avoid values coming from
 * primitive attributes, mixins and defaults.
 *
 * @param {Element} entity Root of the DOM hierarchy.
 * @return {Elment}        Copy of the DOM hierarchy ready for serialization.
 */
function prepareForSerialization(entity) {
  var clone = entity.cloneNode(false);
  var children = entity.childNodes;
  for (var i = 0, l = children.length; i < l; i++) {
    clone.appendChild(prepareForSerialization(children[i]));
  }
  optimizeComponents(clone, entity);
  return clone;
}

/**
 * Removes from copy those components or components' properties that comes from
 * primitive attributes, mixins, injected default components or schema defaults.
 *
 * @param {Element} copy   Destinatary element for the optimization.
 * @param {Element} source Element to be optimized.
 */
function optimizeComponents(copy, source) {
  var components = source.components || {};
  Object.keys(components).forEach(function (name) {
    var component = components[name];
    var implicitValue = getImplicitValue(component, source);
    var currentValue = source.getAttribute(name);
    var optimalUpdate = getOptimalUpdate(component, implicitValue, currentValue);
    if (optimalUpdate === null) {
      copy.removeAttribute(name);
    }
    else {
      copy.setAttribute(name, optimalUpdate, true);
    }
  });
}

/**
 * Computes the value for a component coming from primitive attributes,
 * mixins, primitive defaults, a-frame default components and schema defaults.
 * In this specific order.
 *
 * In other words, it is the value of the component if the author would have not
 * overridden it explicitly.
 *
 * @param {Component} component Component to calculate the value of.
 * @param {Element}   source    Element owning the component.
 * @return                      The computed value for the component of source.
 */
function getImplicitValue(component, source) {
  return (isSingleProperty(component) ? _single : _multi)(component, source);

  function _single() {
    var value = getMixedValue(component, null, source);
    if (value === undefined) {
      value = getInjectedValue(component, null, source);
    }
    if (value === undefined) {
      value = getDefaultValue(component, null, source);
    }
    if (value !== undefined) {
      // XXX: This assumes parse is idempotent
      return component.schema.parse(value);
    }
    return value;
  }

  function _multi() {
    var value;

    Object.keys(component.schema).forEach(function (propertyName) {
      var propertyValue = getFromAttribute(component, propertyName, source);
      if (propertyValue === undefined) {
        propertyValue = getMixedValue(component, propertyName, source);
      }
      if (propertyValue === undefined) {
        propertyValue = getInjectedValue(component, propertyName, source);
      }
      if (propertyValue === undefined) {
        propertyValue = getDefaultValue(component, propertyName, source);
      }
      if (propertyValue !== undefined) {
        var parse = component.schema[propertyName].parse;
        value = value || {};
        // XXX: This assumes parse is idempotent
        value[propertyName] = parse(propertyValue);
      }
    });

    return value;
  }
}

/**
 * Gets the value for the component's property coming from a primitive
 * attribute.
 *
 * Primitives have mappings from attributes to component's properties.
 * The function looks for a present attribute in the source element which
 * maps to the specified component's property.
 *
 * @param  {Component} component    Component to be found.
 * @param  {string}    propertyName Component's property to be found.
 * @param  {Element}   source       Element owning the component.
 * @return {any}                    The value of the component's property coming
 *                                  from the primitive's attribute if any or
 *                                  `undefined`, otherwise.
 */
function getFromAttribute(component, propertyName, source) {
  var value;
  var mappings = source.mappings || {};
  var route = component.name + '.' + propertyName;
  var primitiveAttribute = findAttribute(mappings, route);
  if (primitiveAttribute && source.hasAttribute(primitiveAttribute)) {
    value = source.getAttribute(primitiveAttribute);
  }
  return value;

  function findAttribute(mappings, route) {
    var attributes = Object.keys(mappings);
    for (var i = 0, l = attributes.length; i < l; i++) {
      var attribute = attributes[i];
      if (mappings[attribute] === route) {
        return attribute;
      }
    }
    return undefined;
  }
}

/**
 * Gets the value for a component or component's property coming from mixins of
 * an element.
 *
 * If the component or component's property is not provided by mixins, the
 * functions will return `undefined`.
 *
 * @param {Component} component      Component to be found.
 * @param {string}    [propertyName] If provided, component's property to be
 *                                   found.
 * @param {Element}   source         Element owning the component.
 * @return                           The value of the component or components'
 *                                   property coming from mixins of the source.
 */
function getMixedValue(component, propertyName, source) {
  var value;
  var reversedMixins = source.mixinEls.reverse();
  for (var i = 0; value === undefined && i < reversedMixins.length; i++) {
    var mixin = reversedMixins[i];
    if (mixin.attributes.hasOwnProperty(component.name)) {
      if (!propertyName) {
        value = mixin.getAttribute(component.name);
      }
      else {
        value = mixin.getAttribute(component.name)[propertyName];
      }
    }
  }
  return value;
}

/**
 * Gets the value for a component or component's property coming from primitive
 * defaults or a-frame defaults. In this specific order.
 *
 * @param {Component} component      Component to be found.
 * @param {string}    [propertyName] If provided, component's property to be
 *                                   found.
 * @param {Element}   source         Element owning the component.
 * @return                           The component value coming from the
 *                                   injected default components of source.
 */
function getInjectedValue(component, propertyName, source) {
  var value;
  var primitiveDefaults = source.defaultComponentsFromPrimitive || {};
  var aFrameDefaults = source.defaultComponents || {};
  var defaultSources = [primitiveDefaults, aFrameDefaults];
  for (var i = 0; value === undefined && i < defaultSources.length; i++) {
    var defaults = defaultSources[i];
    if (defaults.hasOwnProperty(component.name)) {
      if (!propertyName) {
        value = defaults[component.name];
      }
      else {
        value = defaults[component.name][propertyName];
      }
    }
  }
  return value;
}

/**
 * Gets the value for a component or component's property coming from schema
 * defaults.
 *
 * @param {Component} component      Component to be found.
 * @param {string}    [propertyName] If provided, component's property to be
 *                                   found.
 * @param {Element}   source         Element owning the component.
 * @return                           The component value coming from the schema
 *                                   default.
 */
function getDefaultValue(component, propertyName, source) {
  if (!propertyName) {
    return component.schema.default;
  }
  return component.schema[propertyName].default;
}

/**
 * Returns the minimum value for a component with an implicit value to equal a
 * reference value. A `null` optimal value means that there is no need for an
 * update since the implicit value and the reference are equal.
 *
 * @param {Component} component Component of the computed value.
 * @param {any}       implicit  The implicit value of the component.
 * @param {any}       reference The reference value for the component.
 * @return                      the minimum value making the component to equal
 *                              the reference value.
 */
function getOptimalUpdate(component, implicit, reference) {
  if (equal(implicit, reference)) {
    return null;
  }
  if (isSingleProperty(component)) {
    return reference;
  }
  var optimal = {};
  Object.keys(reference).forEach(function (key) {
    var needsUpdate = !equal(reference[key], implicit[key]);
    if (needsUpdate) {
      optimal[key] = reference[key];
    }
  });
  return optimal;
}

/**
 * @param {Component} component Component to test if it is single property.
 * @return                      `true` if component is single property.
 */
function isSingleProperty(component) {
  return AFRAME.schema.isSingleProperty(component.schema);
}

/**
 * Detect element's Id collision and returns a valid one
 * @param  {string} baseId Proposed Id
 * @return {string}        Valid Id based on the proposed Id
 */
function getUniqueId (baseId) {
  if (!document.getElementById(baseId)) {
    return baseId;
  }

  var i = 2;
  // If the baseId ends with _#, it extracts the baseId removing the suffix
  var groups = baseId.match(/(\w+)-(\d+)/);
  if (groups) {
    baseId = groups[1];
    i = groups[2];
  }

  while (document.getElementById(baseId + '-' + i)) { i++; }

  return baseId + '-' + i;
}
