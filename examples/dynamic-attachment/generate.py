"""Read FLAG, atomically publish /output/artifact.zip, stay alive for collection."""
import base64
import os
import zipfile
import time

with zipfile.ZipFile('/output/artifact.tmp', 'w', compression=zipfile.ZIP_DEFLATED) as artifact:
    artifact.writestr('challenge.txt', base64.b64encode(os.environ['FLAG'].encode()).decode() + '\n')

os.rename('/output/artifact.tmp', '/output/artifact.zip')
# tmpfs survives only while the container runs. Worker collects and removes it.
time.sleep(120)
