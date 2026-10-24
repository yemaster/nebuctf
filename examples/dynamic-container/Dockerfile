FROM python:3.13-alpine
WORKDIR /app
COPY server.py .
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --start-interval=1s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/', timeout=2).read()"]
CMD ["python", "-B", "server.py"]
