def build_health_payload(app_name):
    return {
        'name': app_name,
        'service': 'backend',
        'status': 'ok'
    }
