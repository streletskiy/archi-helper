// Fixed local document processing. Input paths are resolved by the host before
// this program runs. Document contents never become executable Python.
export const DOCUMENT_WORKER=String.raw`
import json, re, collections, itertools, unicodedata
from pathlib import Path
import pymupdf

def save_json(file, data):
    temporary = file.with_suffix(file.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(file)

def process_documents(request):
    destination = Path(request['directory'])
    result = {'format': 1, 'files': [], 'pages': [], 'findings': [], 'errors': [], 'coverage': {}, 'spellcheck': {}, 'findings_truncated': False}
    dictionaries = {}
    if request.get('spellcheck', False):
        try:
            from spylls.hunspell import Dictionary
            for language in request.get('languages', ['ru', 'en']):
                base = Path(request['dictionaries']) / language / 'index'
                try:
                    dictionaries[language] = Dictionary.from_files(str(base))
                    result['spellcheck'][language] = 'available'
                except Exception as error:
                    result['spellcheck'][language] = 'unavailable: ' + type(error).__name__
        except ImportError:
            result['spellcheck']['status'] = 'unavailable: spylls'
    glossary = {unicodedata.normalize('NFC', word).casefold() for word in request.get('glossary', [])}
    tokens = re.compile(r"[^\W\d_]+(?:[-'][^\W\d_]+)*", re.UNICODE)
    cyrillic = re.compile(r'[\u0400-\u04ff]')
    latin = re.compile(r'[A-Za-z]')
    cache = {}
    max_findings = request.get('max_findings', 5000)
    suggested = 0
    def add_finding(kind, word, page, boxes, suggestion=None):
        if len(result['findings']) >= max_findings:
            result['findings_truncated'] = True
            return
        item = {'kind': kind, 'text': word, 'source': page['source'], 'page': page['page'], 'boxes': boxes, 'certainty': 'review_required'}
        if suggestion is not None:
            item['suggestion'] = suggestion
        result['findings'].append(item)
    for source in request['files']:
        document = None
        entry = {'source': source['label'], 'status': 'running', 'pages': 0, 'processed': 0}
        result['files'].append(entry)
        try:
            document = pymupdf.open(source['path'])
            if not document.is_pdf or document.needs_pass:
                raise ValueError('Unsupported or encrypted PDF')
            entry['pages'] = len(document)
            if not entry['pages']:
                raise ValueError('PDF contains no pages')
            for index in range(len(document)):
                if len(result['pages']) >= request.get('max_pages', 5000):
                    entry['status'] = 'partial'
                    break
                page = document[index]
                textpage = page.get_textpage()
                text = page.get_text('text', textpage=textpage, sort=True)
                image_count = len(page.get_image_info())
                ocr = 'not_requested'
                if request.get('ocr') and (image_count or not text.strip()):
                    try:
                        textpage = page.get_textpage_ocr(language='+'.join({'ru': 'rus', 'en': 'eng'}[language] for language in request.get('languages', ['ru', 'en'])), dpi=150, full=True, tessdata=request['tessdata'])
                        text = page.get_text('text', textpage=textpage, sort=True)
                        ocr = 'completed'
                    except Exception as error:
                        ocr = 'unavailable: ' + type(error).__name__
                blocks = [{'bbox': list(block[:4]), 'text': block[4]} for block in page.get_text('blocks', textpage=textpage, sort=True) if len(block)>6 and block[6]==0]
                item = {'source': source['label'], 'page': index+1, 'width_points': page.rect.width, 'height_points': page.rect.height,
                        'text': text, 'blocks': blocks, 'images': image_count, 'text_status': 'extracted' if text.strip() else 'no_extractable_text',
                        'ocr': ocr, 'visual_status': 'not_reviewed', 'text_in_images': 'ocr_processed_unverified' if ocr=='completed' else 'not_reviewed' if image_count else 'not_detected'}
                if request.get('audit'):
                    seen = set()
                    for match in tokens.finditer(text):
                        word = unicodedata.normalize('NFC', match.group())
                        key = word.casefold()
                        if key in seen or key in glossary or len(word)<2 or len(word)>64:
                            continue
                        seen.add(key)
                        boxes = [list(box) for box in page.search_for(match.group(), textpage=textpage)]
                        if cyrillic.search(word) and latin.search(word):
                            add_finding('mixed_scripts', word, item, boxes)
                            continue
                        language = 'ru' if cyrillic.search(word) else 'en'
                        dictionary = dictionaries.get(language)
                        if dictionary and len(word)>2 and not word.isupper():
                            cache_key = (language, word)
                            if cache_key not in cache:
                                valid = dictionary.lookup(word) or dictionary.lookup(word.lower())
                                alternatives = []
                                if not valid and suggested < 50:
                                    alternatives = list(itertools.islice(dictionary.suggest(word), 3))
                                    suggested += 1
                                cache[cache_key] = (valid, alternatives)
                            valid, alternatives = cache[cache_key]
                            if not valid:
                                add_finding('dictionary_unknown', word, item, boxes, alternatives)
                    repeated = set()
                    for match in re.finditer(r'\b([^\W\d_]{2,})[^\S\r\n]+\1\b', text, re.IGNORECASE):
                        key = match.group().casefold()
                        if key in repeated:
                            continue
                        repeated.add(key)
                        add_finding('repeated_word', match.group(), item, [list(box) for box in page.search_for(match.group(), textpage=textpage)])
                    for replacement in request.get('replacements', []):
                        before = replacement['from']
                        if before in text:
                            add_finding('preferred_term', before, item, [list(box) for box in page.search_for(before, textpage=textpage)], replacement['to'])
                if index+1 in request.get('render_pages', []):
                    filename = 'preview-' + str(len(result['files'])) + '-' + str(index+1) + '.png'
                    scale = min(request.get('dpi', 100)/72, 2400/max(page.rect.width, page.rect.height))
                    page.get_pixmap(matrix=pymupdf.Matrix(scale,scale), alpha=False).save(destination/filename)
                    item['preview'] = filename
                result['pages'].append(item)
                entry['processed'] += 1
                save_json(destination/'document.json', result)
                print('Processed page', len(result['pages']), flush=True)
            if entry['status']=='running':
                entry['status']='completed'
        except Exception as error:
            entry['status']='failed'
            result['errors'].append({'source':source['label'],'error':type(error).__name__ + ': ' + str(error)})
        finally:
            if document:
                document.close()
            save_json(destination/'document.json', result)
    result['coverage'] = {'expected_pages':sum(file['pages'] for file in result['files']), 'processed_pages':len(result['pages']),
                          'pages_with_text':sum(page['text_status']=='extracted' for page in result['pages']),
                          'pages_with_images':sum(page['images']>0 for page in result['pages']), 'visually_reviewed_pages':0,
                          'ocr_completed_pages':sum(page['ocr']=='completed' for page in result['pages']),
                          'image_text_unreviewed_pages':sum(page['text_in_images']=='not_reviewed' for page in result['pages'])}
    save_json(destination/'document.json', result)
    print(json.dumps({'saved':'document.json','pages':len(result['pages']),'findings':len(result['findings']),'errors':len(result['errors'])}), flush=True)
`;
