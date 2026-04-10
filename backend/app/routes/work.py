from flask import Blueprint, Response, request

from ..api_response import error_response, success_response
from ..services.analysis_store import get_analysis_file, list_recent_analyses, save_analysis
from ..services.csv_analyzer import build_csv_analysis

work_bp = Blueprint('work', __name__)


@work_bp.get('/flows/work/recent-analyses')
def recent_analyses():
    return success_response(list_recent_analyses())


@work_bp.get('/flows/work/recent-analyses/<analysis_id>/file')
def recent_analysis_file(analysis_id):
    record = get_analysis_file(analysis_id)

    if not record:
        return error_response('Analysis file not found.', 404)

    return Response(
        record['content'],
        mimetype='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'inline; filename="{record["fileName"]}"',
            'Cache-Control': 'no-store',
        },
    )


@work_bp.post('/flows/work/analyze-csv')
@work_bp.post('/api/work/analyze-csv')
def analyze_csv():
    try:
        uploaded_file = request.files.get('file')

        if uploaded_file is None or not uploaded_file.filename:
            raise ValueError('A CSV file is required.')

        content = uploaded_file.stream.read()
        result = build_csv_analysis(uploaded_file.filename, content)
        record = save_analysis(uploaded_file.filename, content, result)

        return success_response(
            {
                **result,
                'savedAt': record['savedAt'],
                'analysisId': record['id'],
            }
        )
    except ValueError as error:
        return error_response(str(error), 400)
