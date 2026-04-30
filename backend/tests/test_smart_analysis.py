from app.services.smart_analysis import build_ticket_summary_fallback


def test_build_ticket_summary_fallback_includes_latest_update_and_failure_reason():
    ticket = {
        'ticket_id': 'INC3722000',
        'issue': 'MModal will not reliably launch on Desktop LAHDH8XNZ84',
        'latest_update': 'Remoted into device LAHDH8XNZ84. Unable to open company portal to investigate or reinstall MModal Fluency Direct.',
        'status': '4 - Low',
        'assigned_to': 'Andrew Cordell',
    }

    summary = build_ticket_summary_fallback(
        ticket,
        '503 Server Error: SERVICE UNAVAILABLE for url: http://ai-gateway:5001/v1/chat/completions',
    )

    assert 'Ticket INC3722000 is for MModal will not reliably launch on Desktop LAHDH8XNZ84.' in summary
    assert 'Unable to open company portal to investigate or reinstall MModal Fluency Direct.' in summary
    assert 'Current status is 4 - Low and the ticket is assigned to Andrew Cordell.' in summary
    assert 'The next logical step is to remove that blocker' in summary
    assert '503 Server Error: SERVICE UNAVAILABLE' in summary
