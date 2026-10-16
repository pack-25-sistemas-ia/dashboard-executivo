import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  FileError, IMPORT_LIMITS, buildColumns, ingest, inferColumn, parseCell, parseNumber, readImportFile, safeCell, toCsv, zonedToIso,
  type ColumnDef, type RawCell,
} from '@/lib/bi/engine';

const s = (v: string): RawCell => ({ t: 's', v });
const col = (type: ColumnDef['type'], extra: Partial<ColumnDef> = {}): ColumnDef => ({ key: 'c1', name: 'Valor', type, semantic: 'measure', required: false, locale: 'br', dedupe: false, ...extra });
const TZ = 'America/Sao_Paulo';
const val = (raw: RawCell, c: ColumnDef) => { const r = parseCell(raw, c, TZ); return r.ok ? r.value : `ERR:${r.code}`; };

describe('números no padrão brasileiro', () => {
  it('vírgula decimal, ponto de milhar, moeda, negativos e percentual', () => {
    expect(parseNumber('1.234,56', 'br')).toEqual({ ok: true, value: '1234.56' });
    expect(parseNumber('R$ 1.234,50', 'br')).toEqual({ ok: true, value: '1234.5' });
    expect(parseNumber('-R$ 10,00', 'br')).toEqual({ ok: true, value: '-10' });
    expect(parseNumber('(1.000,00)', 'br')).toEqual({ ok: true, value: '-1000' });
    expect(parseNumber('50-', 'br')).toEqual({ ok: true, value: '-50' });
    expect(parseNumber('1,234.56', 'us')).toEqual({ ok: true, value: '1234.56' });
  });
  it('recusa formatos ambíguos ou lixo em vez de adivinhar', () => {
    expect(parseNumber('12.5', 'br').ok).toBe(false); // ponto que não é milhar
    expect(parseNumber('1,2,3', 'br').ok).toBe(false);
    expect(parseNumber('abc', 'br').ok).toBe(false);
    expect(parseNumber('1e9', 'br').ok).toBe(false);
    expect(parseNumber('0,1234567', 'br').ok).toBe(false); // > 6 casas
    expect(parseNumber('1'.repeat(16), 'br').ok).toBe(false);
  });
  it('tipagem por coluna: inteiro, moeda, percentual e vazio obrigatório', () => {
    expect(val(s('12,5'), col('integer'))).toBe('ERR:not_integer');
    expect(val(s('1.000'), col('integer'))).toBe('1000');
    expect(val(s('R$ 99,90'), col('currency'))).toBe('99.9');
    expect(val(s('12,5%'), col('percentage'))).toBe('12.5');
    expect(val(s(''), col('decimal'))).toBeNull();
    expect(val(s('  '), col('decimal', { required: true }))).toBe('ERR:required');
    expect(val({ t: 'n', v: '1234.5' }, col('decimal'))).toBe('1234.5'); // XLSX nativo ignora o formato regional
  });
});

describe('datas e fuso', () => {
  it('DD/MM/AAAA, ISO e validade real do calendário', () => {
    expect(val(s('05/03/2026'), col('date'))).toBe('2026-03-05');
    expect(val(s('2026-03-05'), col('date'))).toBe('2026-03-05');
    expect(val(s('29/02/2024'), col('date'))).toBe('2024-02-29');
    expect(val(s('29/02/2026'), col('date'))).toBe('ERR:invalid_date');
    expect(val(s('31/04/2026'), col('date'))).toBe('ERR:invalid_date');
    expect(val(s('05/03/26'), col('date'))).toBe('ERR:invalid_date'); // ano de 2 dígitos é ambíguo
    expect(val(s('13/13/2026'), col('date'))).toBe('ERR:invalid_date');
  });
  it('data e hora entram no fuso da empresa e saem com deslocamento explícito', () => {
    expect(val(s('05/03/2026 10:30'), col('timestamp'))).toBe('2026-03-05T10:30:00-03:00');
    expect(val(s('2026-03-05T10:30:00Z'), col('timestamp'))).toBe('2026-03-05T10:30:00+00:00');
    expect(zonedToIso(2026, 1, 15, 12, 0, 0, 'UTC')).toBe('2026-01-15T12:00:00+00:00');
    expect(val(s('05/03/2026 25:00'), col('timestamp'))).toBe('ERR:invalid_timestamp');
  });
  it('série numérica do Excel vira data (inclui o defeito de 1900 a partir de 61)', () => {
    expect(val({ t: 'n', v: '45000' }, col('date'))).toBe('2023-03-15');
    expect(val({ t: 'n', v: '61' }, col('date'))).toBe('1900-03-01');
    expect(val({ t: 'n', v: '-5' }, col('date'))).toBe('ERR:invalid_date');
  });
});

describe('texto e booleano', () => {
  it('limpa controles, limita tamanho e entende sim/não', () => {
    expect(val(s('  a\u0000b\nc  '), col('string'))).toBe('ab c');
    expect(val(s('x'.repeat(501)), col('string'))).toBe('ERR:too_long');
    expect(val(s('Sim'), col('boolean'))).toBe(true);
    expect(val(s('não'), col('boolean'))).toBe(false);
    expect(val(s('talvez'), col('boolean'))).toBe('ERR:invalid_boolean');
  });
  it('conteúdo que parece fórmula é guardado como texto inerte e neutralizado na exportação', () => {
    expect(val(s('=HYPERLINK("http://x")'), col('string'))).toBe('=HYPERLINK("http://x")');
    expect(safeCell('=1+1')).toBe("'=1+1");
    expect(safeCell('@cmd')).toBe("'@cmd");
    expect(safeCell('-2+3')).toBe("'-2+3");
    expect(safeCell({ num: '-10.5' })).toBe('-10.5');
    expect(toCsv(['a'], [['x;y']])).toBe('﻿a\r\n"x;y"\r\n');
  });
});

describe('inferência de tipos', () => {
  const inf = (vals: string[]) => inferColumn(vals.map(s));
  it('reconhece os tipos brasileiros mais comuns', () => {
    expect(inf(['1', '2', '30']).type).toBe('integer');
    expect(inf(['1.234,50', '10,00']).type).toBe('decimal');
    expect(inf(['R$ 10,00', 'R$ 25,50']).type).toBe('currency');
    expect(inf(['10%', '12,5%']).type).toBe('percentage');
    expect(inf(['01/02/2026', '15/03/2026']).type).toBe('date');
    expect(inf(['01/02/2026 10:00', '15/03/2026 18:30']).type).toBe('timestamp');
    expect(inf(['sim', 'não', 'sim']).type).toBe('boolean');
    expect(inf(['Loja A', 'Loja B']).type).toBe('string');
  });
  it('códigos com zero à esquerda ficam como texto e milhar ambíguo gera aviso', () => {
    expect(inf(['00123', '00456']).type).toBe('string');
    expect(inf(['1.234', '2.345']).warning).toMatch(/milhar/);
  });
  it('números nativos do XLSX (12,5) nunca são tomados por data; célula com formato de data continua data', () => {
    expect(inferColumn([{ t: 'n', v: '12.5' }, { t: 'n', v: '3.25' }]).type).toBe('decimal');
    expect(inferColumn([{ t: 'n', v: '10' }, { t: 'n', v: '45000' }]).type).toBe('integer');
    expect(inferColumn([{ t: 'd', v: '2023-03-15' }, { t: 'd', v: '2023-03-16' }]).type).toBe('date');
    expect(inferColumn([{ t: 'd', v: '2023-03-15T10:00:00' }, { t: 'd', v: '2023-03-16T11:30:00' }]).type).toBe('timestamp');
  });
  it('nomes duplicados e vazios viram colunas distintas c1..cn', () => {
    const cols = buildColumns(['Valor', 'valor', ''], [inf(['1']), inf(['2']), inf(['x'])]);
    expect(cols.map((c) => c.key)).toEqual(['c1', 'c2', 'c3']);
    expect(new Set(cols.map((c) => c.name.toLowerCase())).size).toBe(3);
  });
  it('um nome de coluna malicioso é só rótulo: a chave interna é sempre cN', () => {
    const cols = buildColumns(['x"; drop table datasets; --'], [inf(['a'])]);
    expect(cols[0]!.key).toBe('c1');
  });
});

describe('ingestão com mapeamento', () => {
  const rows: RawCell[][] = [
    [s('01/02/2026'), s('Loja A'), s('1.000,00')],
    [s('02/02/2026'), s('Loja B'), s('abc')],
    [s('01/02/2026'), s('Loja A'), s('50,00')],
    [s('31/02/2026'), s('Loja C'), s('10,00')],
  ];
  const cols: ColumnDef[] = [
    col('date', { key: 'c1', name: 'Data', semantic: 'time', dedupe: true }),
    col('string', { key: 'c2', name: 'Loja', semantic: 'dimension', dedupe: true }),
    col('currency', { key: 'c3', name: 'Valor' }),
  ];
  it('aponta cada erro com linha e coluna, não descarta em silêncio e acusa duplicidade pela chave', () => {
    const r = ingest(rows, cols, [0, 1, 2], TZ);
    expect(r.totalRows).toBe(4);
    expect(r.valid.map((v) => v.rowNumber)).toEqual([2]);
    expect(r.invalidRows).toBe(3);
    expect(r.errors.find((e) => e.row === 3)).toMatchObject({ columnKey: 'c3', code: 'invalid_number', value: 'abc' });
    expect(r.errors.find((e) => e.row === 4)?.code).toBe('duplicate_in_file');
    expect(r.errors.find((e) => e.row === 5)).toMatchObject({ columnKey: 'c1', code: 'invalid_date' });
    expect(r.duplicateInFile).toBe(1);
  });
  it('chave de deduplicação vazia rejeita a linha (não vira a chave «null»)', () => {
    const r = ingest([[s('01/02/2026'), s('')], [s('02/02/2026'), s('B')]], [col('date', { key: 'c1' }), col('string', { key: 'c2', dedupe: true })], [0, 1], TZ);
    expect(r.valid.map((v) => v.rowNumber)).toEqual([3]);
    expect(r.errors).toEqual([expect.objectContaining({ row: 2, columnKey: 'c2', code: 'key_empty' })]);
  });
  it('coluna sem origem fica vazia e coluna obrigatória vazia vira erro', () => {
    const r = ingest([[s('01/02/2026')]], [col('date', { key: 'c1' }), col('string', { key: 'c2', required: true })], [0, null], TZ);
    expect(r.errors[0]).toMatchObject({ code: 'required', columnKey: 'c2' });
  });
});

// ---------------------------------------------------------------------------- arquivos
const csv = (text: string, enc: 'utf8' | 'latin1' = 'utf8') => (enc === 'utf8' ? new TextEncoder().encode(text) : Uint8Array.from(Buffer.from(text, 'latin1')));

describe('leitura de CSV', () => {
  it('detecta ; e vírgula, BOM, aspas escapadas e quebra de linha em campo', () => {
    const a = readImportFile(csv('﻿nome;valor\r\n"Ana ""A""";"1.000,50"\r\n"x\ny";2\r\n'), 'a.csv');
    expect(a.headers).toEqual(['nome', 'valor']);
    expect(a.rows).toHaveLength(2);
    expect(a.rows[0]![0]).toEqual({ t: 's', v: 'Ana "A"' });
    const b = readImportFile(csv('a,b\n1,2\n'), 'b.csv');
    expect(b.headers).toEqual(['a', 'b']);
  });
  it('Windows-1252 é convertido e avisado', () => {
    const r = readImportFile(csv('nome;valor\nJosé;1\n', 'latin1'), 'c.csv');
    expect(r.rows[0]![0]).toEqual({ t: 's', v: 'José' });
    expect(r.notes.join(' ')).toMatch(/Windows-1252/);
  });
  it('recusa vazio, só cabeçalho, aspas abertas, binário, extensão enganosa e limites', () => {
    expect(() => readImportFile(csv(''), 'a.csv')).toThrow(FileError);
    expect(() => readImportFile(csv('a;b\n'), 'a.csv')).toThrow(/nenhuma linha/);
    expect(() => readImportFile(csv('a;b\n"x;1\n'), 'a.csv')).toThrow(/Aspas/);
    expect(() => readImportFile(Uint8Array.from([0x41, 0, 0x42, 0x0a, 0x43]), 'a.csv')).toThrow(/não parece texto/);
    expect(() => readImportFile(csv('a;b\n1;2\n'), 'a.exe')).toThrow(/\.csv ou \.xlsx/);
    expect(() => readImportFile(csv('a;b\n1;2\n'), 'a.xlsm')).toThrow(/macros/);
    expect(() => readImportFile(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]), 'a.csv')).toThrow(/\.xls/);
    expect(() => readImportFile(csv('%PDF-1.4 ...'), 'a.csv')).toThrow(/PDF/);
    const many = `a\n${'1\n'.repeat(IMPORT_LIMITS.rows + 1)}`;
    expect(() => readImportFile(csv(many), 'a.csv')).toThrow(/linhas/);
    expect(() => readImportFile(csv(`${Array.from({ length: IMPORT_LIMITS.cols + 1 }, (_, i) => `h${i}`).join(';')}\n1\n`), 'a.csv')).toThrow(/colunas/);
    expect(() => readImportFile(csv(`a\n${'x'.repeat(IMPORT_LIMITS.cellChars + 1)}\n`), 'a.csv')).toThrow(/célula/);
  });
});

const WB = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Vendas" sheetId="1" r:id="rId1"/><sheet name="Oculta" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>';
const RELS = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>';
const STYLES = '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="10"/><xf numFmtId="22"/></cellXfs></styleSheet>';
const SST = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Data</t></si><si><t>Loja &amp; Cia</t></si><si><r><t>Valor</t></r><r><t> total</t></r></si><si><t>Taxa</t></si><si><t>Ativo</t></si></sst>';
const SHEET1 = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
  + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>'
  + '<row r="2"><c r="A2" s="1"><v>45000</v></c><c r="B2" t="inlineStr"><is><t>Loja A</t></is></c><c r="C2"><v>0.30000000000000004</v></c><c r="D2" s="2"><v>0.125</v></c><c r="E2" t="b"><v>1</v></c></row>'
  + '<row r="3"><c r="A3" s="3"><v>45001.5</v></c><c r="B3" t="str"><f>CONCAT("a","b")</f><v>ab</v></c><c r="C3"><f>SUM(C2:C2)</f><v>1234.5</v></c><c r="E3" t="b"><v>0</v></c></row>'
  + '</sheetData></worksheet>';
const SHEET2 = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row><row r="2"><c r="A2"><v>1</v></c></row></sheetData></worksheet>';

function xlsx(extra: Record<string, Uint8Array> = {}, sheet1 = SHEET1): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8(WB), 'xl/_rels/workbook.xml.rels': strToU8(RELS), 'xl/styles.xml': strToU8(STYLES),
    'xl/sharedStrings.xml': strToU8(SST), 'xl/worksheets/sheet1.xml': strToU8(sheet1), 'xl/worksheets/sheet2.xml': strToU8(SHEET2), ...extra,
  });
}

describe('leitura de XLSX', () => {
  it('lê abas, textos compartilhados e ricos, datas, percentuais, booleanos e limpa ruído binário', () => {
    const r = readImportFile(xlsx(), 'a.xlsx');
    expect(r.kind).toBe('xlsx');
    expect(r.sheets).toEqual([{ name: 'Vendas', hidden: false }, { name: 'Oculta', hidden: true }]);
    expect(r.sheet).toBe('Vendas');
    expect(r.headers).toEqual(['Data', 'Loja & Cia', 'Valor total', 'Taxa', 'Ativo']);
    expect(r.rows[0]).toEqual([{ t: 'd', v: '2023-03-15' }, { t: 's', v: 'Loja A' }, { t: 'n', v: '0.3' }, { t: 's', v: '12.5%' }, { t: 'b', v: true }]);
    expect(r.rows[1]![0]).toEqual({ t: 'd', v: '2023-03-16T12:00:00' });
    expect(r.rows[1]![3]).toBeNull();
  });
  it('fórmulas: só o valor em cache é lido (nada é executado) e o usuário é avisado', () => {
    const r = readImportFile(xlsx(), 'a.xlsx');
    expect(r.rows[1]![1]).toEqual({ t: 's', v: 'ab' });
    expect(r.rows[1]![2]).toEqual({ t: 'n', v: '1234.5' });
    expect(r.notes.join(' ')).toMatch(/fórmula/);
  });
  it('escolhe a aba pedida e recusa aba inexistente', () => {
    expect(readImportFile(xlsx(), 'a.xlsx', 'Oculta').headers).toEqual(['x']);
    expect(() => readImportFile(xlsx(), 'a.xlsx', 'Nada')).toThrow(/Aba não encontrada/);
  });
  it('macros (vbaProject.bin) são recusadas mesmo com extensão .xlsx', () => {
    expect(() => readImportFile(xlsx({ 'xl/vbaProject.bin': strToU8('MZ') }), 'a.xlsx')).toThrow(/macros/);
  });
  it('zip bomb: parte descompactada gigante é recusada antes de inflar', () => {
    const bomb = xlsx({ 'xl/worksheets/sheet3.xml': new Uint8Array(130 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => readImportFile(bomb, 'a.xlsx')).toThrow(/grande demais/);
  });
  it('zip bomb pelo total: várias partes aceitáveis que somadas passam do limite', () => {
    const part = () => new Uint8Array(90 * 1024 * 1024);
    const bomb = xlsx({ 'xl/worksheets/sheet3.xml': part(), 'xl/worksheets/sheet4.xml': part() });
    expect(() => readImportFile(bomb, 'a.xlsx')).toThrow(/depois de descompactada/);
  });
  it('arquivo .xlsx que não é zip ou não é planilha é recusado com mensagem amigável', () => {
    expect(() => readImportFile(zipSync({ 'a.txt': strToU8('oi') }), 'a.xlsx')).toThrow(/xlsx válida/);
    expect(() => readImportFile(Uint8Array.from([0x50, 0x4b, 3, 4, 9, 9, 9, 9]), 'a.xlsx')).toThrow(FileError);
  });
  it('entidades numéricas inválidas não geram caracteres de controle', () => {
    const sheet = SHEET1.replace('Loja A', 'A&#0;B&#x7;C&lt;D');
    const r = readImportFile(xlsx({}, sheet), 'a.xlsx');
    expect(r.rows[0]![1]).toEqual({ t: 's', v: 'ABC<D' });
  });
});
