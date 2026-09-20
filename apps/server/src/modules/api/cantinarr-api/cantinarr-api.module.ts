import { Module } from '@nestjs/common';
import { CantinarrApiService } from './cantinarr-api.service';
import { CantinarrSettingsController } from './cantinarr-settings.controller';

@Module({
  providers: [CantinarrApiService],
  controllers: [CantinarrSettingsController],
  exports: [CantinarrApiService],
})
export class CantinarrApiModule {}
