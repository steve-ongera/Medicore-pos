# api/notifications.py
from api.models import Notification, NotificationPriority


def notify(users, title, message="", link="", priority=NotificationPriority.NORMAL, dedupe_key=""):
    """Create a notification for each user. With a dedupe_key, a user never gets the same key twice.

    Use it from anywhere:  notify(User.objects.filter(role="PHARMACIST"), "Low stock", link="/inventory")
    """
    created = []
    for u in users:
        if dedupe_key and Notification.objects.filter(recipient=u, dedupe_key=dedupe_key).exists():
            continue
        created.append(Notification.objects.create(
            recipient=u, title=title, message=message, link=link,
            priority=priority, dedupe_key=dedupe_key,
        ))
    return created