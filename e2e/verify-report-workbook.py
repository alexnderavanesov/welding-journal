"""Validate large downloaded XLSX without expanding its complete XML in memory."""
import json, re, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    total = 0
    found = False
    columns = 0
    joints = set()
    for name in archive.namelist():
        if not name.startswith('xl/worksheets/sheet'):
            continue
        rows = 0
        carry = b''
        with archive.open(name) as sheet:
            while chunk := sheet.read(1024 * 1024):
                data = carry + chunk
                found = found or sys.argv[2].encode() in data
                # Retain only a tag-sized suffix so matches crossing chunks count once.
                boundary = max(0, len(data) - 256)
                rows += sum(1 for m in re.finditer(b'<row ', data) if m.start() < boundary)
                columns += sum(1 for m in re.finditer(b'<col ', data) if m.start() < boundary)
                joints.update(int(m.group(1)) for m in re.finditer(rb'MAX-EXPORT-F(\d+)', data) if m.start() < boundary)
                carry = data[boundary:]
            rows += carry.count(b'<row ')
            columns += carry.count(b'<col ')
            found = found or sys.argv[2].encode() in carry
            joints.update(int(m.group(1)) for m in re.finditer(rb'MAX-EXPORT-F(\d+)', carry))
        total += rows - 1
    print(json.dumps({'dataRows': total, 'columns': columns, 'found': found, 'distinctJoints': len(joints), 'firstJoint': min(joints, default=0), 'lastJoint': max(joints, default=0)}))
