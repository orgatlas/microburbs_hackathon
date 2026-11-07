from django.contrib import admin
from django.urls import include, path

# Everything lives under /api or /admin: Nginx only routes those prefixes to Django.
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("matching.urls")),
]
