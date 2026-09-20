import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import {
  CantinarrSetting,
  cantinarrSettingSchema,
} from '@maintainerr/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { CantinarrApiService } from './cantinarr-api.service';

@Controller('api/settings')
export class CantinarrSettingsController {
  constructor(private readonly cantinarr: CantinarrApiService) {}
  @Get('cantinarr')
  get() {
    return this.cantinarr.getSettings();
  }
  @Post('cantinarr')
  save(
    @Body(new ZodValidationPipe(cantinarrSettingSchema))
    input: CantinarrSetting,
  ) {
    return this.cantinarr.save(input);
  }
  @Delete('cantinarr')
  remove() {
    return this.cantinarr.remove();
  }
  @Post('test/cantinarr')
  test(
    @Body(new ZodValidationPipe(cantinarrSettingSchema))
    input: CantinarrSetting,
  ) {
    return this.cantinarr.test(input);
  }
}
