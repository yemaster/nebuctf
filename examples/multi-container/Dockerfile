FROM python:3.12-slim
WORKDIR /app
COPY server.py .
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=1s --timeout=2s --retries=10 CMD python -B -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=1).read()"
CMD ["python", "-B", "server.py"]
