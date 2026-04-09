def build_placeholder_response(payload):
    return {
        'status': 'accepted',
        'message': 'Placeholder chat endpoint. Integrate a model provider in the gateway service.',
        'received': payload
    }
