"""Regenerate independent, synthetic font fixtures; never reads a user's PDF.

Development-only dependencies: fonttools, pypdf, reportlab.
See CJK-FIXTURES.md for input font, license, and independent Poppler commands.
"""
import argparse
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from pypdf import PdfWriter
from pypdf.generic import (
    DictionaryObject as D, NameObject as N, NumberObject as I,
    ArrayObject as A, TextStringObject as T, DecodedStreamObject as S,
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--font', type=Path, required=True, help='Licensed Noto Sans CJK Regular TTC')
parser.add_argument('--font-number', type=int, default=2, help='Simplified Chinese face in the TTC')
parser.add_argument('--font-license', type=Path, required=True, help='License/copyright supplied with that font')
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent)
args = parser.parse_args()
out = args.output
out.mkdir(parents=True, exist_ok=True)
text = '中文汉字页境测试简体繁體縮圖预览ABC123'
source = TTFont(args.font, fontNumber=args.font_number)
gset = source.getGlyphSet()
cmap = source.getBestCmap()
order = ['.notdef'] + [f'uni{ord(c):04X}' for c in dict.fromkeys(text)]
glyphs, metrics, charmap = {}, {}, {}
for name in order:
    old = '.notdef' if name == '.notdef' else cmap[int(name[3:], 16)]
    pen = TTGlyphPen(None)
    gset[old].draw(Cu2QuPen(pen, 1, reverse_direction=True))
    glyphs[name] = pen.glyph()
    metrics[name] = source['hmtx'][old]
    if name != '.notdef':
        charmap[int(name[3:], 16)] = name
builder = FontBuilder(source['head'].unitsPerEm, isTTF=True)
builder.setupGlyphOrder(order)
builder.setupCharacterMap(charmap)
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics(metrics)
builder.setupHorizontalHeader(ascent=880, descent=-120)
builder.setupOS2(sTypoAscender=880, sTypoDescender=-120, usWinAscent=1160, usWinDescent=290)
builder.setupNameTable({
    'familyName': 'LeafSpaceFixtureCJK', 'styleName': 'Regular',
    'uniqueFontIdentifier': 'LeafSpaceFixtureCJK', 'fullName': 'LeafSpaceFixtureCJK Regular',
    'psName': 'LeafSpaceFixtureCJK-Regular', 'version': 'Version 1.0',
    'copyright': 'Derived from Noto Sans CJK, Copyright 2014-2021 Adobe and Google. SIL Open Font License 1.1.',
})
builder.setupPost()
builder.setupMaxp()
builder.save(out / 'fixture-cjk.ttf')

writer = PdfWriter()
page = writer.add_blank_page(width=600, height=360)


def obj(value):
    return writer._add_object(value)


def stream(data):
    value = S()
    value.set_data(data)
    return obj(value)


fontdata = (out / 'fixture-cjk.ttf').read_bytes()
fontfile = S()
fontfile.set_data(fontdata)
fontfile[N('/Length1')] = I(len(fontdata))
descriptor = obj(D({
    N('/Type'): N('/FontDescriptor'), N('/FontName'): N('/LSFIXT+LeafSpaceFixtureCJK-Regular'),
    N('/Flags'): I(4), N('/FontBBox'): A([I(0), I(-290), I(1000), I(1160)]),
    N('/ItalicAngle'): I(0), N('/Ascent'): I(880), N('/Descent'): I(-120),
    N('/CapHeight'): I(730), N('/StemV'): I(80), N('/FontFile2'): obj(fontfile),
}))
widths = A()
for cid, name in enumerate(order[1:], 1):
    widths.extend([I(cid), A([I(metrics[name][0])])])
child = obj(D({
    N('/Type'): N('/Font'), N('/Subtype'): N('/CIDFontType2'),
    N('/BaseFont'): N('/LSFIXT+LeafSpaceFixtureCJK-Regular'),
    N('/CIDSystemInfo'): D({N('/Registry'): T('Adobe'), N('/Ordering'): T('Identity'), N('/Supplement'): I(0)}),
    N('/FontDescriptor'): descriptor, N('/CIDToGIDMap'): N('/Identity'), N('/DW'): I(1000), N('/W'): widths,
}))
codes = {char: index + 1 for index, char in enumerate(dict.fromkeys(text))}
mappings = '\n'.join(f'<{cid:04X}> <{ord(char):04X}>' for char, cid in codes.items())
unicode_map = f'''/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /LeafSpaceFixture-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
{len(codes)} beginbfchar
{mappings}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end'''.encode()
font = obj(D({
    N('/Type'): N('/Font'), N('/Subtype'): N('/Type0'),
    N('/BaseFont'): N('/LSFIXT+LeafSpaceFixtureCJK-Regular'), N('/Encoding'): N('/Identity-H'),
    N('/DescendantFonts'): A([child]), N('/ToUnicode'): stream(unicode_map),
}))
page[N('/Resources')] = D({N('/Font'): D({N('/F1'): font})})
lines = [('中文汉字页境测试', 32, 280), ('简体繁體縮圖预览', 32, 210), ('中文ABC123汉字', 28, 140)]
content = '\n'.join(
    f'BT /F1 {size} Tf 50 {y} Td <' + ''.join(f'{codes[char]:04X}' for char in line) + '> Tj ET'
    for line, size, y in lines
)
page[N('/Contents')] = stream(content.encode())
writer.add_metadata({'/Title': 'Synthetic embedded CJK thumbnail regression', '/Author': 'LeafSpace test fixture'})
with (out / 'embedded-cjk-identity-h.pdf').open('wb') as output:
    writer.write(output)

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
output = canvas.Canvas(str(out / 'nonembedded-cjk-unigb.pdf'), pagesize=(600, 360))
output.setTitle('Synthetic nonembedded CJK CMap regression')
output.setFont('STSong-Light', 32)
output.drawString(50, 280, '中文汉字页境测试')
output.drawString(50, 210, '简体繁體縮圖预览')
output.save()
output = canvas.Canvas(str(out / 'nonembedded-standard-font.pdf'), pagesize=(600, 360))
output.setTitle('Synthetic standard font regression')
output.setFont('Helvetica', 32)
output.drawString(50, 280, 'Standard font ABC 123')
output.setFont('Times-Roman', 28)
output.drawString(50, 210, 'Paths and fallback preview')
output.save()
(out / 'CJK-FONT-LICENSE.txt').write_bytes(args.font_license.read_bytes())
print('Created 3 independent synthetic PDFs and a renamed, licensed font subset.')
