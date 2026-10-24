FROM python:3.12-slim
WORKDIR /app
COPY server.py settings.py ./
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=2s --start-period=5s --start-interval=1s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=1).read()"]
CMD ["python", "-B", "server.py"]
