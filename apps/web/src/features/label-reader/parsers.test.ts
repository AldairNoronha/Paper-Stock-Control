import { describe, expect, it } from 'vitest';

import { parseLabel } from './parsers';

describe('supplier label parsers', () => {
  it('parses the real Impress QR payload without inventing the unknown field', () => {
    const result = parseLabel({
      text: '',
      ocrConfidence: 0,
      codes: [
        {
          format: 'QR_CODE',
          value:
            '90113 UNICOLOR IP420 2760x1860mm;0;820;E-102893/010-15-I-01;05.09.2026 19:07;04/12/26'
        }
      ]
    });

    expect(result.parserName).toBe('ImpressLabelParser');
    expect(result.fields.supplier.value).toBe('IMPRESS');
    expect(result.fields.quantitySheets.value).toBe(820);
    expect(result.fields.supplierPalletCode.value).toBe('E-102893/010-15-I-01');
    expect(result.fields.widthMm.value).toBe(1860);
    expect(result.fields.lengthMm.value).toBe(2760);
    expect(result.fields.manufacturedAt.value).toBe('2026-09-05T19:07:00');
    expect(result.fields.expiresOn.value).toBe('2026-12-04');
  });

  it('parses the real Schattdecor QR payload', () => {
    const result = parseLabel({
      text: 'schattdecor',
      ocrConfidence: 0.7,
      codes: [
        {
          format: 'QR_CODE',
          value: 'ASFALTO|D009247968|800 |1865 |2765 |4125.38 |superior|'
        }
      ]
    });

    expect(result.fields.supplier.value).toBe('SCHATTDECOR');
    expect(result.fields.supplierMaterialName.value).toBe('ASFALTO');
    expect(result.fields.lotCode.value).toBe('D009247968');
    expect(result.fields.quantitySheets.value).toBe(800);
    expect(result.fields.declaredAreaM2.value).toBe(4125.38);
    expect(result.fields.orientation.value).toBe('SUPERIOR');
  });

  it('extracts Interprint fields from OCR and barcode evidence', () => {
    const result = parseLabel({
      ocrConfidence: 0.86,
      codes: [{ format: 'CODE_128', value: '8081196011' }],
      text: `INTERPRINT
Material Nr. 041036/011
Referência descrição
FREIJÓ TUCUMÃ 1865X2765 UP Freijó
Data Produção 26.08.2026
Quantidade / Quantity (m2) 5.466,32
Lote / Batch 8081196011
Quant. / Quantity (pc) 1060`
    });

    expect(result.parserName).toBe('InterprintLabelParser');
    expect(result.fields.supplier.value).toBe('INTERPRINT');
    expect(result.fields.supplierMaterialName.value).toMatch(/FREIJÓ TUCUMÃ/);
    expect(result.fields.lotCode.value).toBe('8081196011');
    expect(result.fields.lotCode.sources).toContain('BARCODE');
    expect(result.fields.quantitySheets.value).toBe(1060);
    expect(result.fields.widthMm.value).toBe(1865);
    expect(result.fields.lengthMm.value).toBe(2765);
    expect(result.fields.declaredAreaM2.value).toBe(5466.32);
    expect(result.fields.manufacturedAt.value).toBe('2026-08-26');
  });

  it('keeps unreadable values unknown', () => {
    const result = parseLabel({ text: 'texto sem identificação', ocrConfidence: 0.3, codes: [] });

    expect(result.parserName).toBe('UnknownLabelParser');
    expect(result.fields.supplier.value).toBeNull();
    expect(result.fields.quantitySheets.value).toBeNull();
    expect(result.fields.lotCode.value).toBeNull();
  });

  it('uses Schattdecor barcode and noisy OCR from the supplied photo', () => {
    const result = parseLabel({
      ocrConfidence: 0.55,
      codes: [{ format: 'CODE_128', value: 'D009247388' }],
      text: `Flora lac MDF LTDA
CONVES
2765
1865
1052
850
ffsuperi`
    });

    expect(result.parserName).toBe('SchattdecorLabelParser');
    expect(result.fields.supplier.value).toBe('SCHATTDECOR');
    expect(result.fields.supplierMaterialName.value).toBe('CONVES');
    expect(result.fields.lotCode.value).toBe('D009247388');
    expect(result.fields.lotCode.sources).toContain('BARCODE');
    expect(result.fields.quantitySheets.value).toBe(850);
  });

  it('recognizes noisy Interprint OCR from the supplied photo', () => {
    const result = parseLabel({
      ocrConfidence: 0.65,
      codes: [],
      text: `Maternal Nr
041086/011/
Tamanho / Size (mm)
1865 / 2765
Quantidade / Quantitv (mz)
5.466,32
Data Produção / Prod. Date
26.08.2026
Reference description
IFREIJÓ TUCUMA
1865X2765 UP Freijó
Lote / Batch Barcode
8081196011
1060`
    });

    expect(result.parserName).toBe('InterprintLabelParser');
    expect(result.fields.supplierMaterialName.value).toBe('FREIJÓ TUCUMA');
    expect(result.fields.lotCode.value).toBe('8081196011');
    expect(result.fields.quantitySheets.value).toBe(1060);
    expect(result.fields.declaredAreaM2.value).toBe(5466.32);
    expect(result.fields.manufacturedAt.value).toBe('2026-08-26');
  });
});
