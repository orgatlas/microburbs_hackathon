from django.urls import path

from . import views

urlpatterns = [
    path("auth/register", views.register),
    path("auth/login", views.login),
    path("auth/logout", views.logout),
    path("me", views.me),
    path("quiz-results", views.save_quiz),
]
