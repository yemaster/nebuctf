FROM python:3.12-slim
WORKDIR /app
COPY server.py .
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=1s --timeout=2s --retries=10 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health')"
CMD ["python", "-B", "server.py"]
