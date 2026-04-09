from flask import jsonify


def success_response(data, status_code=200):
    return jsonify({'success': True, 'data': data}), status_code


def error_response(message, status_code=400, details=None):
    payload = {'success': False, 'error': message}

    if details is not None:
        payload['details'] = details

    return jsonify(payload), status_code
