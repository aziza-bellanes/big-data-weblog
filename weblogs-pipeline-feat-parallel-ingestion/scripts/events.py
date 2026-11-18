"""Shared NASA CLF contract. Dates use server-local time, matching the original Hive SQL."""
import gzip
import hashlib
import re
from datetime import datetime
from pathlib import Path

CLF = re.compile(r'^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\S+)$')


def source_files(directory):
    files = sorted(Path(directory).glob('NASA_access_log_*'),
                   key=lambda p: (0 if 'Jul95' in p.name else 1, p.name))
    if not files:
        raise ValueError(f'No NASA files in {directory}')
    names = [p.name.removesuffix('.gz') for p in files]
    if len(names) != len(set(names)):
        raise ValueError('Both compressed and plain copies of the same source exist')
    return files


def records(files):
    for path in files:
        opener = gzip.open if path.suffix == '.gz' else open
        with opener(path, 'rt', encoding='latin-1', newline='') as stream:
            for number, line in enumerate(stream, 1):
                yield event(path.name.removesuffix('.gz'), number, line.rstrip('\r\n'))


def event(source, number, raw):
    result = dict(event_id=hashlib.sha256(f'{source}:{number}'.encode()).hexdigest(),
                  source_file=source, source_line=number, raw_line=raw,
                  event_time=None, dt='unknown', host=None, method=None,
                  resource=None, http_status=None, bytes=None, parse_error=None)
    match = CLF.fullmatch(raw)
    if not match:
        result['parse_error'] = 'invalid CLF'
        return result
    host, _, _, timestamp, request, status, size = match.groups()
    try:
        date = datetime.strptime(timestamp, '%d/%b/%Y:%H:%M:%S %z')
        parts = request.split()
        result.update(event_time=date.isoformat(), dt=date.date().isoformat(), host=host,
                      method=parts[0] if parts else None,
                      resource=parts[1] if len(parts) > 1 else None,
                      http_status=int(status), bytes=0 if size == '-' else int(size))
    except ValueError as exc:
        result['parse_error'] = str(exc)
    return result
