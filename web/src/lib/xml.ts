export function parseXml(text: string, context: string): XMLDocument {
  const parser = new DOMParser();
  const document = parser.parseFromString(text, "application/xml");
  const errorNode = document.querySelector("parsererror");

  if (errorNode) {
    throw new Error(`Cannot parse XML for ${context}.`);
  }

  return document;
}

export function serializeXml(document: XMLDocument): string {
  return new XMLSerializer().serializeToString(document);
}

export function childText(parent: Element, tagName: string): string {
  return parent.querySelector(`:scope > ${tagName}`)?.textContent?.trim() ?? "";
}

export function requiredChildText(parent: Element, tagName: string, context: string): string {
  const value = childText(parent, tagName);
  if (!value) {
    throw new Error(`Missing required field '${tagName}' in ${context}.`);
  }

  return value;
}

export function replaceDirectChild(parent: Element, tagName: string, replacement: Element | null): void {
  const current = parent.querySelector(`:scope > ${tagName}`);
  if (current) {
    current.remove();
  }

  if (replacement) {
    parent.appendChild(replacement);
  }
}
