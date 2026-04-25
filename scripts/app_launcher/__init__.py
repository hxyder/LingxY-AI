"""LingxY application launcher — Python sidecar for the Node service's
``launch_app`` action_tool.

See ``phases/tasks/83_polish_launcher_cards_notifications.md`` for the
architectural plan. This package is invoked from Node via subprocess; the
public entry point is :func:`launcher.open_app` and the corresponding
``launcher.py`` CLI.
"""
