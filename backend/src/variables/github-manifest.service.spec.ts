import { loadAll } from 'js-yaml';
import { stripHelmTemplating } from './github-manifest.service';

function configMapData(template: string): unknown {
  const docs: Array<{ data?: unknown }> = [];
  loadAll(
    stripHelmTemplating(template),
    (doc) => docs.push(doc as { data?: unknown }),
    { json: true },
  );
  return docs[0]?.data;
}

describe('stripHelmTemplating', () => {
  it.each([
    [
      'variable assignment line',
      '{{- $app := .Values.backend }}\nkind: ConfigMap\ndata:\n  A: "1"\n',
    ],
    ['comment line', '{{/* backend */}}\nkind: ConfigMap\ndata:\n  A: "1"\n'],
    [
      'include line',
      'kind: ConfigMap\nmetadata:\n  labels:\n    {{- include "labels" . | nindent 4 }}\ndata:\n  A: "1"\n',
    ],
    [
      'range/end block',
      'kind: ConfigMap\ndata:\n{{- range $k, $v := .Values.env }}\n  {{ $k }}: {{ $v }}\n{{- end }}\n  A: "1"\n',
    ],
  ])('parses a template with a %s', (_label, template) => {
    expect(configMapData(template)).toEqual({ A: '1' });
  });

  it('keeps the last value when if/else branches repeat a key', () => {
    expect(
      configMapData(
        'kind: ConfigMap\ndata:\n{{- if .Values.prod }}\n  A: "prod"\n{{- else }}\n  A: "dev"\n{{- end }}\n',
      ),
    ).toEqual({ A: 'dev' });
  });

  it('keeps the key when only the value is templated', () => {
    expect(
      configMapData('kind: ConfigMap\ndata:\n  A: {{ .Values.a }}\n'),
    ).toEqual({ A: '__HELM_VALUE__' });
  });
});
