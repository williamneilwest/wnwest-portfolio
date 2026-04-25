from app.utils.note_cleaner import clean_note_blob, clean_ticket_notes


def test_clean_ticket_notes_simplifies_acknowledgements_and_removes_text_notifications():
    notes = [
        {
            'author': 'Marky Morillo (Additional comments)',
            'timestamp': '2026-04-22 10:00:00',
            'text': 'Thank you for taking the time to submit a ticket. Your local IT Team has received your ticket and we will be in contact with you.',
            'type': 'Additional comments',
        },
        {
            'author': 'System',
            'timestamp': '2026-04-22 10:01:00',
            'text': 'Text has been sent on assigned user phone number.',
            'type': 'Work notes',
        },
        {
            'author': 'Tech',
            'timestamp': '2026-04-22 10:05:00',
            'text': 'Restarted the print spooler and confirmed the printer is online.',
            'type': 'Work notes',
        },
        {
            'author': 'Tech',
            'timestamp': '2026-04-22 10:06:00',
            'text': 'Restarted the print spooler and confirmed the printer is online.',
            'type': 'Work notes',
        },
    ]

    assert clean_ticket_notes(notes) == [
        {
            'author': 'Marky Morillo (Additional comments)',
            'timestamp': '2026-04-22 10:00:00',
            'text': 'Marky Morillo acknowledged the ticket.',
            'type': 'Additional comments',
        },
        {
            'author': 'Tech',
            'timestamp': '2026-04-22 10:05:00',
            'text': 'Restarted the print spooler and confirmed the printer is online.',
            'type': 'Work notes',
        },
    ]


def test_clean_note_blob_keeps_meaningful_notes():
    blob = """
Marky Morillo (Additional comments)
Thank you for taking the time to submit a ticket.

System
Text has been sent on assigned user phone number.

Tech
Re-imaged the device and returned it to the user.
"""

    assert clean_note_blob(blob) == (
        'Marky Morillo acknowledged the ticket.\n\n'
        'Tech Re-imaged the device and returned it to the user.'
    )
