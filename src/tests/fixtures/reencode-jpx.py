#!/usr/bin/env python3
"""Optional source regeneration; no network or third-party document inputs.
Original encoder: Python 3.12.14, Pillow 12.3.0, OpenJPEG 2.5.4.
The Node generator needs neither Python nor Pillow.
"""
from pathlib import Path
from io import BytesIO
import base64, hashlib, json, sys
import PIL
from PIL import Image, ImageDraw, features
image = Image.new('RGB', (256, 256), 'white')
draw = ImageDraw.Draw(image)
draw.rectangle((20, 20, 235, 120), fill=(210, 40, 40))
draw.rectangle((20, 136, 235, 235), fill=(20, 130, 40))
stream = BytesIO()
image.save(stream, format='JPEG2000', irreversible=False)
output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / 'synthetic-scan.jp2'
output.write_bytes(stream.getvalue())
print(json.dumps({'python': sys.version.split()[0], 'pillow': PIL.__version__, 'openjpeg': features.version('jpg_2000'), 'bytes': len(stream.getvalue()), 'sha256': hashlib.sha256(stream.getvalue()).hexdigest()}))
print(base64.b64encode(stream.getvalue()).decode())
