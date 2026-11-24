"""BIFF cell evidence: xlrd exposes saved values, not formula expressions."""
import hashlib
import json
import sys
from pathlib import Path
import xlrd

source, output = map(Path, sys.argv[1:3])
book = xlrd.open_workbook(str(source), formatting_info=True, on_demand=True)
if book.nsheets > 256:
    raise ValueError('Workbook exceeds sheet budget')
evidence = []
slots = 0
sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
for index in range(book.nsheets):
    sheet = book.sheet_by_index(index)
    slots += sheet.nrows * sheet.ncols
    if slots > 100000 or sheet.nrows > 10000 or sheet.ncols > 256:
        raise ValueError('Workbook exceeds cell budget')
    for row in range(sheet.nrows):
        cells = []
        for column in range(sheet.ncols):
            cell = sheet.cell(row, column)
            address = xlrd.formula.colname(column) + str(row + 1)
            covered = next(((r0, c0) for r0, r1, c0, c1 in sheet.merged_cells if r0 <= row < r1 and c0 <= column < c1 and (row, column) != (r0, c0)), None)
            format_key = book.xf_list[cell.xf_index].format_key
            number_format = book.format_map.get(format_key)
            value = None if covered else cell.value
            item = {'address': address, 'type': cell.ctype, 'value': value, 'text': '' if covered or cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK) else str(value), 'numberFormat': number_format.format_str if number_format else 'General'}
            if covered:
                item['coveredBy'] = xlrd.formula.colname(covered[1]) + str(covered[0] + 1)
            if not covered and cell.ctype == xlrd.XL_CELL_DATE:
                try:
                    item['dateIso'] = xlrd.xldate_as_datetime(cell.value, book.datemode).isoformat()
                except xlrd.XLDateError:
                    item['dateIso'] = None
            cells.append(item)
        if not any(cell['value'] not in ('', None) for cell in cells):
            continue
        evidence.append({'schema': 'evidence-v1', 'id': f'xls-{index}-{row + 1}', 'kind': 'worksheet_row', 'source': {'sheet': sheet.name, 'rowStart': row + 1, 'rowEnd': row + 1, 'cellRange': f'A{row + 1}:{xlrd.formula.colname(sheet.ncols - 1)}{row + 1}'}, 'objectKeys': [], 'text': ' | '.join(cell['text'] for cell in cells), 'producer': 'xlrd-2.0.2-native-v1', 'data': {'sheetIndex': index, 'date1904': bool(book.datemode), 'cells': cells, 'merges': sheet.merged_cells if row == 0 else [], 'mergeCoordinates': 'zero_based_half_open', 'formulaExpressionsAvailable': False, 'originalSha256': sha256}})
    book.unload_sheet(index)
output.write_text(json.dumps(evidence, ensure_ascii=False, allow_nan=False), encoding='utf-8')
